"""Team / operator users router (v2, admin only).

* ``GET    /api/users``      → ``UserOut[]`` (never includes password hashes)
* ``POST   /api/users``      → create (bcrypt-hashed password)
* ``PATCH  /api/users/{id}`` → update full_name / role / password
* ``DELETE /api/users/{id}`` → 204; refuses self-delete and deleting (or
  demoting) the last admin with 409 so the Console can never be locked out.

Every mutation is audited.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..core import audit, db, security
from ..models.schemas import UserCreate, UserOut, UserUpdate

logger = logging.getLogger("attendyo.users")

router = APIRouter(prefix="/api/users", tags=["users"])

_USER_COLUMNS = "id, email, full_name, role, created_at"


def _to_user(row: dict[str, Any]) -> UserOut:
    return UserOut(
        id=str(row["id"]),
        email=row["email"],
        full_name=row.get("full_name"),
        role=row["role"],
        created_at=row["created_at"],
    )


def _admin_count() -> int:
    row = db.query_one("SELECT count(*) AS c FROM users WHERE role = 'admin'")
    return int((row or {}).get("c", 0))


@router.get("", response_model=list[UserOut])
async def list_users(_admin: dict = Depends(security.require_admin)) -> list[UserOut]:
    rows = await run_in_threadpool(
        db.query_all, f"SELECT {_USER_COLUMNS} FROM users ORDER BY created_at ASC"
    )
    return [_to_user(r) for r in rows]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    admin: dict = Depends(security.require_admin),
) -> UserOut:
    """Create an operator login. Email must be unique (case-insensitive)."""
    email = payload.email.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required")

    def _insert() -> dict[str, Any] | None:
        existing = db.query_one(
            "SELECT 1 FROM users WHERE lower(email) = lower(%s)", (email,)
        )
        if existing:
            return None
        return db.execute_returning(
            f"""
            INSERT INTO users (email, password_hash, full_name, role)
            VALUES (%s, %s, %s, %s)
            RETURNING {_USER_COLUMNS}
            """,
            (email, security.hash_password(payload.password), payload.full_name, payload.role),
        )

    row = await run_in_threadpool(_insert)
    if row is None:
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    await run_in_threadpool(
        audit.record, admin, "user.create", entity="user", entity_id=str(row["id"]),
        details={"email": email, "role": payload.role},
    )
    return _to_user(row)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    admin: dict = Depends(security.require_admin),
) -> UserOut:
    """Update a user's name, role and/or password."""
    updates = payload.model_dump(exclude_unset=True)
    target = await run_in_threadpool(
        db.query_one, f"SELECT {_USER_COLUMNS} FROM users WHERE id = %s", (user_id,)
    )
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not updates:
        return _to_user(target)

    # Guard: never demote the last remaining admin (would brick the Console).
    if (
        updates.get("role") is not None
        and updates["role"] != "admin"
        and target["role"] == "admin"
    ):
        admins = await run_in_threadpool(_admin_count)
        if admins <= 1:
            raise HTTPException(
                status_code=409, detail="Cannot demote the last administrator"
            )

    set_parts: list[str] = []
    params: list[Any] = []
    changed: list[str] = []
    if "full_name" in updates:
        set_parts.append("full_name = %s")
        params.append(updates["full_name"])
        changed.append("full_name")
    if updates.get("role") is not None:
        set_parts.append("role = %s")
        params.append(updates["role"])
        changed.append("role")
    if updates.get("password"):
        set_parts.append("password_hash = %s")
        params.append(security.hash_password(updates["password"]))
        changed.append("password")
    if not set_parts:
        return _to_user(target)

    params.append(user_id)
    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE users SET {', '.join(set_parts)} WHERE id = %s RETURNING {_USER_COLUMNS}",
        params,
    )
    assert row is not None
    await run_in_threadpool(
        audit.record, admin, "user.update", entity="user", entity_id=user_id,
        details={"fields": changed},  # never the password itself
    )
    return _to_user(row)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_user(
    user_id: str,
    admin: dict = Depends(security.require_admin),
) -> None:
    """Delete a user. Refuses self-delete and deleting the last admin (409)."""
    if str(admin["id"]) == user_id:
        raise HTTPException(status_code=409, detail="You cannot delete your own account")
    target = await run_in_threadpool(
        db.query_one, "SELECT id, email, role FROM users WHERE id = %s", (user_id,)
    )
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target["role"] == "admin":
        admins = await run_in_threadpool(_admin_count)
        if admins <= 1:
            raise HTTPException(
                status_code=409, detail="Cannot delete the last administrator"
            )
    await run_in_threadpool(db.execute, "DELETE FROM users WHERE id = %s", (user_id,))
    await run_in_threadpool(
        audit.record, admin, "user.delete", entity="user", entity_id=user_id,
        details={"email": target.get("email")},
    )
    return None
