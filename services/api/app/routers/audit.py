"""Audit log router (v2, admin only).

* ``GET /api/audit?limit=&action=&user=`` → ``AuditEntry[]`` (newest first)

The log itself is written by ``app.core.audit.record`` from every mutating
route. This endpoint is read-only — the table is append-only by design.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import AuditEntry

logger = logging.getLogger("attendyo.audit.router")

router = APIRouter(prefix="/api/audit", tags=["audit"])


def _to_entry(row: dict[str, Any]) -> AuditEntry:
    return AuditEntry(
        id=row["id"],
        ts=row["ts"],
        user_email=row.get("user_email"),
        action=row["action"],
        entity=row.get("entity"),
        entity_id=row.get("entity_id"),
        details=row.get("details") or {},
    )


@router.get("", response_model=list[AuditEntry])
async def list_audit(
    limit: int = Query(100, ge=1, le=1000),
    action: Optional[str] = Query(None, description="Exact action, e.g. member.create"),
    user: Optional[str] = Query(None, description="Filter by actor email (substring)"),
    _admin: dict = Depends(security.require_admin),
) -> list[AuditEntry]:
    """List audit entries, newest first, with optional filters."""
    clauses: list[str] = []
    params: list[Any] = []
    if action:
        clauses.append("action = %s")
        params.append(action)
    if user:
        clauses.append("user_email ILIKE %s")
        params.append(f"%{user}%")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = (
        "SELECT id, ts, user_email, action, entity, entity_id, details "
        f"FROM audit_log {where} ORDER BY ts DESC, id DESC LIMIT %s"
    )
    params.append(limit)
    rows = await run_in_threadpool(db.query_all, sql, params)
    return [_to_entry(r) for r in rows]
