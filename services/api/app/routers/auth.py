"""Auth router — ``POST /api/auth/login`` and ``GET /api/auth/me``."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import LoginRequest, TokenResponse, UserOut

logger = logging.getLogger("liwan.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _find_user_by_email(email: str) -> dict[str, Any] | None:
    return db.query_one(
        "SELECT id, email, password_hash, full_name, role, created_at "
        "FROM users WHERE lower(email) = lower(%s)",
        (email,),
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest) -> TokenResponse:
    """Exchange operator credentials for a bearer token.

    Uses a constant-ish error path (same 401 for unknown user and bad password)
    so the endpoint does not reveal which emails exist.
    """
    user = await run_in_threadpool(_find_user_by_email, str(payload.email))
    if user is None or not security.verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = security.create_access_token(str(user["id"]), role=user["role"])
    return TokenResponse(access_token=token, token_type="bearer")


@router.get("/me", response_model=UserOut)
async def me(current_user: dict[str, Any] = Depends(security.get_current_user)) -> UserOut:
    """Return the currently authenticated operator."""
    return UserOut(
        id=str(current_user["id"]),
        email=current_user["email"],
        full_name=current_user.get("full_name"),
        role=current_user["role"],
        created_at=current_user["created_at"],
    )
