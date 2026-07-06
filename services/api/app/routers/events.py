"""Events router — historical list + live SSE stream.

* ``GET /api/events?date=&decision=&door_id=&limit=`` → ``AccessEvent[]``.
* ``GET /api/events/stream``                          → SSE (``access`` + ``alert``).

The stream emits one ``event: access`` SSE message per new decision and one
``event: alert`` per security alert (non-granted decisions). Both the Console
live monitor and the Gate kiosk subscribe. Heartbeat comments keep proxies
from idling the connection.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..core import db, media, security
from ..events_bus import bus
from ..models.schemas import AccessEvent

logger = logging.getLogger("attendyo.events")

router = APIRouter(prefix="/api/events", tags=["events"])

_EVENT_SELECT = """
    SELECT e.id, e.ts, e.member_id, m.full_name AS member_name, e.subject_name,
           e.similarity, e.door_id, d.name AS door_name, e.camera_id,
           e.direction, e.decision, e.reason, e.snapshot_path
    FROM access_events e
    LEFT JOIN members m ON m.id = e.member_id
    LEFT JOIN doors   d ON d.id = e.door_id
"""


def _row_to_event(row: dict[str, Any]) -> AccessEvent:
    return AccessEvent(
        id=row["id"],
        ts=row["ts"],
        member_id=str(row["member_id"]) if row.get("member_id") else None,
        member_name=row.get("member_name"),
        subject_name=row.get("subject_name"),
        similarity=float(row["similarity"]) if row.get("similarity") is not None else None,
        door_id=str(row["door_id"]) if row.get("door_id") else None,
        door_name=row.get("door_name"),
        direction=row.get("direction") or "unknown",
        decision=row["decision"],
        reason=row.get("reason"),
        snapshot_url=media.public_url(row.get("snapshot_path")),
    )


@router.get("", response_model=list[AccessEvent])
async def list_events(
    date: Optional[str] = Query(None, description="Filter to a single day YYYY-MM-DD"),
    decision: Optional[str] = Query(None),
    door_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    _user: dict = Depends(security.get_current_user),
) -> list[AccessEvent]:
    """List recent access events, newest first, with optional filters."""
    clauses: list[str] = []
    params: list[Any] = []
    if date:
        try:
            day = dt.date.fromisoformat(date)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid date (YYYY-MM-DD)") from exc
        clauses.append("e.ts::date = %s")
        params.append(day)
    if decision:
        clauses.append("e.decision = %s")
        params.append(decision)
    if door_id:
        clauses.append("e.door_id = %s")
        params.append(door_id)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"{_EVENT_SELECT} {where} ORDER BY e.ts DESC LIMIT %s"
    params.append(limit)
    rows = await run_in_threadpool(db.query_all, sql, params)
    return [_row_to_event(r) for r in rows]


@router.get("/stream")
async def stream(
    request: Request,
    token: Optional[str] = Query(
        None,
        description="Bearer token as a query param for browser EventSource "
        "clients that cannot set an Authorization header.",
    ),
) -> StreamingResponse:
    """Server-Sent Events stream of live access decisions (``event: access``).

    Auth accepts either the standard ``Authorization: Bearer`` header or a
    ``?token=`` query param, because the browser ``EventSource`` API cannot set
    headers. Either way the token is verified before the stream opens.
    """
    bearer = token
    if not bearer:
        hdr = request.headers.get("authorization", "")
        if hdr.lower().startswith("bearer "):
            bearer = hdr[7:]
    if not bearer:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = security.decode_token(bearer)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=401,
            detail="Malformed token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await run_in_threadpool(security._load_user, sub)
    if user is None:
        raise HTTPException(status_code=401, detail="User no longer exists")

    async def event_generator() -> AsyncIterator[bytes]:
        queue = await bus.subscribe()
        # Prime the connection so clients flip to "connected" immediately.
        yield b": connected\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    envelope = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    # Heartbeat comment; keeps intermediaries from dropping us.
                    yield b": keep-alive\n\n"
                    continue
                event_type = envelope.get("event", "access")
                data = json.dumps(envelope.get("data", {}), default=str)
                yield f"event: {event_type}\ndata: {data}\n\n".encode("utf-8")
        finally:
            await bus.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering for SSE
        },
    )
