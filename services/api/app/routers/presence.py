"""Presence / muster router (v2).

* ``GET /api/presence/now`` → everyone currently on site: members whose *today*
  attendance row has ``first_in_ts`` set and no later ``last_out_ts``.

The Console renders this as the live on-site list and a print-ready evacuation
(muster) view — hence the door name of the first entry, so responders know
which entrance each person used.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import PresenceNow, PresencePerson

logger = logging.getLogger("attendyo.presence")

router = APIRouter(prefix="/api/presence", tags=["presence"])


def _site_local_today() -> dt.date:
    """Today in the site's timezone (falls back to server date)."""
    row = db.query_one("SELECT timezone FROM sites ORDER BY created_at LIMIT 1")
    tz_name = (row or {}).get("timezone") or "Africa/Casablanca"
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo(tz_name)).date()
    except Exception:  # pragma: no cover - bad tz name in DB
        return dt.date.today()


def _compute_presence() -> PresenceNow:
    today = _site_local_today()
    rows: list[dict[str, Any]] = db.query_all(
        """
        SELECT a.member_id,
               m.full_name AS member_name,
               m.department,
               m.member_type,
               a.first_in_ts,
               d.name AS first_in_door_name
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        LEFT JOIN doors d ON d.id = a.first_in_door
        WHERE a.work_date = %s
          AND a.first_in_ts IS NOT NULL
          AND (a.last_out_ts IS NULL OR a.last_out_ts <= a.first_in_ts)
        ORDER BY a.first_in_ts ASC
        """,
        (today,),
    )
    people = [
        PresencePerson(
            member_id=str(r["member_id"]),
            member_name=r["member_name"],
            department=r.get("department"),
            member_type=r["member_type"],
            first_in_ts=r["first_in_ts"],
            first_in_door_name=r.get("first_in_door_name"),
        )
        for r in rows
    ]
    return PresenceNow(count=len(people), people=people)


@router.get("/now", response_model=PresenceNow)
async def presence_now(_user: dict = Depends(security.get_current_user)) -> PresenceNow:
    """Live on-site list (checked in today, not yet checked out)."""
    return await run_in_threadpool(_compute_presence)
