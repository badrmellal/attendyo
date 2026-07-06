"""Alerts router — persistent, acknowledgeable security notifications.

* ``GET  /api/alerts?acknowledged=&kind=&limit=`` → ``Alert[]`` (newest first)
* ``GET  /api/alerts/count``                      → ``{ unacknowledged }`` (badge)
* ``POST /api/alerts/{id}/ack``                   → ``Alert``
* ``POST /api/alerts/ack-all``                    → ``{ acknowledged }``

Alerts are **created automatically** by the recognition path for every
non-granted decision (see :func:`record_decision_alert`, called by the
recognize router) and can also be system-generated. Operators acknowledge them;
the actor is taken from the JWT and audited.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..core import audit, db, security
from ..models.schemas import AckAllResult, Alert, AlertCount, AlertKind

logger = logging.getLogger("attendyo.alerts")

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

_ALERT_SELECT = """
    SELECT a.id, a.ts, a.kind, a.severity, a.message, a.event_id,
           a.door_id, d.name AS door_name,
           a.member_id, m.full_name AS member_name,
           a.acknowledged, u.email AS acknowledged_by_email, a.acknowledged_at
    FROM alerts a
    LEFT JOIN doors   d ON d.id = a.door_id
    LEFT JOIN members m ON m.id = a.member_id
    LEFT JOIN users   u ON u.id = a.acknowledged_by
"""

# Severity per decision kind (contract: unknown_face/not_authorized → warning,
# off_schedule → info).
_KIND_SEVERITY = {
    "unknown_face": "warning",
    "not_authorized": "warning",
    "off_schedule": "info",
    "system": "warning",
}

# Plain-French default messages (the Console may relabel via its i18n layer).
_KIND_MESSAGES = {
    "unknown_face": "Visage inconnu à {door}",
    "not_authorized": "Accès non autorisé pour {who} à {door}",
    "off_schedule": "Accès hors horaire pour {who} à {door}",
}


def _row_to_alert(row: dict[str, Any]) -> Alert:
    return Alert(
        id=row["id"],
        ts=row["ts"],
        kind=row["kind"],
        severity=row["severity"],
        message=row["message"],
        event_id=row.get("event_id"),
        door_id=str(row["door_id"]) if row.get("door_id") else None,
        door_name=row.get("door_name"),
        member_id=str(row["member_id"]) if row.get("member_id") else None,
        member_name=row.get("member_name"),
        acknowledged=bool(row.get("acknowledged", False)),
        acknowledged_by_email=row.get("acknowledged_by_email"),
        acknowledged_at=row.get("acknowledged_at"),
    )


def record_decision_alert(
    *,
    decision: str,
    reason: Optional[str],
    event_id: Optional[int],
    door_id: Optional[str],
    door_name: Optional[str],
    member_id: Optional[str],
    member_name: Optional[str],
) -> Optional[dict[str, Any]]:
    """Insert an alert row for a non-granted decision (sync; call in a thread).

    Returns the contract-shaped ``Alert`` payload (for SSE publication) or
    ``None`` when the insert failed — alert creation must never break the
    recognition hot path.
    """
    kind = decision if decision in _KIND_MESSAGES else "system"
    severity = _KIND_SEVERITY.get(kind, "warning")
    template = _KIND_MESSAGES.get(kind, "Événement de sécurité à {door}")
    message = template.format(
        who=member_name or "inconnu",
        door=door_name or "porte inconnue",
    )
    if reason in ("expired", "not_yet_valid"):
        message += " (accès expiré)" if reason == "expired" else " (accès pas encore valide)"

    try:
        row = db.execute_returning(
            """
            INSERT INTO alerts (kind, severity, message, event_id, door_id, member_id)
            VALUES (%s,%s,%s,%s,%s,%s)
            RETURNING id, ts
            """,
            (kind, severity, message, event_id, door_id, member_id),
        )
    except Exception as exc:  # pragma: no cover - hot path must not break
        logger.warning("Could not record alert for decision %s: %s", decision, exc)
        return None
    assert row is not None
    return {
        "id": row["id"],
        "ts": row["ts"].isoformat() if hasattr(row["ts"], "isoformat") else row["ts"],
        "kind": kind,
        "severity": severity,
        "message": message,
        "event_id": event_id,
        "door_id": door_id,
        "door_name": door_name,
        "member_id": member_id,
        "member_name": member_name,
        "acknowledged": False,
    }


@router.get("", response_model=list[Alert])
async def list_alerts(
    acknowledged: Optional[bool] = Query(None),
    kind: Optional[AlertKind] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    _user: dict = Depends(security.get_current_user),
) -> list[Alert]:
    """List alerts, newest first, optionally filtered by ack state and kind."""
    clauses: list[str] = []
    params: list[Any] = []
    if acknowledged is not None:
        clauses.append("a.acknowledged = %s")
        params.append(acknowledged)
    if kind:
        clauses.append("a.kind = %s")
        params.append(kind)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"{_ALERT_SELECT} {where} ORDER BY a.ts DESC LIMIT %s"
    params.append(limit)
    rows = await run_in_threadpool(db.query_all, sql, params)
    return [_row_to_alert(r) for r in rows]


@router.get("/count", response_model=AlertCount)
async def alert_count(_user: dict = Depends(security.get_current_user)) -> AlertCount:
    """Unacknowledged-alert count for the Console badge."""
    row = await run_in_threadpool(
        db.query_one, "SELECT count(*) AS c FROM alerts WHERE NOT acknowledged"
    )
    return AlertCount(unacknowledged=int((row or {}).get("c", 0)))


@router.post("/ack-all", response_model=AckAllResult)
async def ack_all(user: dict = Depends(security.require_operator)) -> AckAllResult:
    """Acknowledge every open alert at once. Actor comes from the JWT."""
    count = await run_in_threadpool(
        db.execute,
        "UPDATE alerts SET acknowledged = TRUE, acknowledged_by = %s, "
        "acknowledged_at = now() WHERE NOT acknowledged",
        (str(user["id"]),),
    )
    await run_in_threadpool(
        audit.record, user, "alerts.ack", entity="alert",
        details={"scope": "all", "acknowledged": count},
    )
    return AckAllResult(acknowledged=count)


@router.post("/{alert_id}/ack", response_model=Alert)
async def ack_alert(
    alert_id: int,
    user: dict = Depends(security.require_operator),
) -> Alert:
    """Acknowledge one alert. Idempotent: re-acking keeps the first actor."""
    updated = await run_in_threadpool(
        db.execute,
        "UPDATE alerts SET acknowledged = TRUE, acknowledged_by = %s, "
        "acknowledged_at = now() WHERE id = %s AND NOT acknowledged",
        (str(user["id"]), alert_id),
    )
    row = await run_in_threadpool(
        db.query_one, f"{_ALERT_SELECT} WHERE a.id = %s", (alert_id,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    if updated:
        await run_in_threadpool(
            audit.record, user, "alerts.ack", entity="alert", entity_id=str(alert_id),
        )
    return _row_to_alert(row)
