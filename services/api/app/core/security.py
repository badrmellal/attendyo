"""Authentication & authorization.

Two independent credentials live here:

* **Operator JWT** — issued by ``POST /api/auth/login`` and required on every
  ``/api/*`` call from the Console/Gate UI (``Authorization: Bearer <token>``).
* **Device key** — a shared secret sent as ``X-Device-Key`` by cameras / the
  Bridge / the Gate kiosk on the hot path ``POST /api/recognize`` only.

Passwords are hashed with bcrypt via passlib.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from . import db
from .config import get_settings

logger = logging.getLogger("liwan.security")

# bcrypt with a sane work factor; deprecated schemes auto-rejected.
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# tokenUrl is informational (Swagger "Authorize"); auto_error off so we can craft
# a contract-shaped 401 ourselves.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# --------------------------------------------------------------------------- #
# Password helpers
# --------------------------------------------------------------------------- #
def hash_password(plain: str) -> str:
    """Return a bcrypt hash of ``plain``."""
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time verify of a plaintext password against a stored hash."""
    try:
        return _pwd_context.verify(plain, hashed)
    except ValueError:  # malformed hash
        return False


# --------------------------------------------------------------------------- #
# JWT helpers
# --------------------------------------------------------------------------- #
def create_access_token(subject: str, *, role: str, extra: dict[str, Any] | None = None) -> str:
    """Issue a signed JWT for an operator.

    ``subject`` is the user id (UUID string). ``role`` is embedded so route
    guards can authorize without a second DB round-trip.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.liwan_jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT, raising 401 on any failure."""
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.liwan_jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# --------------------------------------------------------------------------- #
# FastAPI dependencies
# --------------------------------------------------------------------------- #
def _load_user(user_id: str) -> dict[str, Any] | None:
    """Fetch a user row by id (sync; call already off-loop or in a dep thread)."""
    return db.query_one(
        "SELECT id, email, full_name, role, created_at FROM users WHERE id = %s",
        (user_id,),
    )


async def get_current_user(token: str | None = Depends(oauth2_scheme)) -> dict[str, Any]:
    """Resolve the authenticated operator from the bearer token.

    Raises 401 if the token is missing, invalid, or the user no longer exists.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    from starlette.concurrency import run_in_threadpool

    user = await run_in_threadpool(_load_user, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_current_user_flex(
    token: str | None = Depends(oauth2_scheme),
    token_q: str | None = Query(default=None, alias="token"),
) -> dict[str, Any]:
    """Operator auth that also accepts ``?token=<jwt>`` as a query parameter.

    Browser ``EventSource`` (SSE) and ``window.open`` / direct-download links
    (CSV export) cannot set an ``Authorization`` header, so they pass the JWT in
    the query string instead. Header takes precedence when both are present.
    """
    effective = token or token_q
    if not effective:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(effective)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    from starlette.concurrency import run_in_threadpool

    user = await run_in_threadpool(_load_user, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def allow_operator_or_device(
    token: str | None = Depends(oauth2_scheme),
    token_q: str | None = Query(default=None, alias="token"),
    x_device_key: str | None = Header(default=None, alias="X-Device-Key"),
) -> None:
    """Read guard for non-sensitive resources (e.g. branding in GET /api/settings).

    Satisfied by EITHER a valid operator JWT (header or ``?token=``) OR a valid
    ``X-Device-Key``. The Gate kiosk holds only the device key, yet must be able
    to read the customer's white-label branding to theme itself.
    """
    settings = get_settings()
    if x_device_key and x_device_key == settings.liwan_device_key:
        return
    effective = token or token_q
    if effective:
        decode_token(effective)  # raises 401 if invalid
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_admin(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Guard for admin-only routes (e.g. PUT /api/settings)."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return user


def require_operator(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Guard for mutating day-to-day routes (enrol, CRUD, ack alerts, import).

    ``admin`` and ``operator`` pass; ``viewer`` is read-only per the role
    definitions in ``db/schema.sql``.
    """
    if user.get("role") not in ("admin", "operator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operator privileges required",
        )
    return user


async def require_device_key(
    x_device_key: str | None = Header(default=None, alias="X-Device-Key"),
) -> str:
    """Authorize a device call on the recognition hot path.

    Cameras, the Bridge and the Gate kiosk authenticate with the shared
    ``LIWAN_DEVICE_KEY`` rather than an operator JWT.
    """
    settings = get_settings()
    expected = settings.liwan_device_key
    # Reject when unset/placeholder to avoid an open recognition endpoint.
    if not x_device_key or x_device_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing device key",
            headers={"WWW-Authenticate": "X-Device-Key"},
        )
    return x_device_key
