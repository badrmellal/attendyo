"""Dashboard stats router — ``GET /api/stats/today``.

Returns the day's headline numbers for the Console overview:
``present``, ``late``, ``absent``, ``on_site_now``, ``denied_today``,
``total_members``, ``last_in`` (the most recent granted event) and an ``hourly``
histogram of granted entries.

All counts are computed in the site timezone's "today" so a site in Casablanca
rolls over at local midnight, not UTC.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from ..core import db, media, security
from ..models.schemas import AccessEvent, HourlyBucket, StatsToday

logger = logging.getLogger("liwan.stats")

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _site_timezone() -> str:
    row = db.query_one("SELECT timezone FROM sites ORDER BY created_at LIMIT 1")
    return (row or {}).get("timezone") or "Africa/Casablanca"


def _local_today(tz_name: str) -> dt.date:
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo(tz_name)).date()
    except Exception:  # pragma: no cover
        return dt.date.today()


def _compute_today() -> StatsToday:
    tz_name = _site_timezone()
    today = _local_today(tz_name)

    total_members = (
        db.query_one("SELECT count(*) AS c FROM members WHERE status = 'active'") or {"c": 0}
    )["c"]

    # Attendance status counts for today.
    status_rows = db.query_all(
        """
        SELECT a.status, count(*) AS c
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date = %s
        GROUP BY a.status
        """,
        (today,),
    )
    counts = {r["status"]: r["c"] for r in status_rows}
    present = counts.get("present", 0)
    late = counts.get("late", 0)
    incomplete = counts.get("incomplete", 0)
    # "present" headline = anyone who showed up (present + incomplete); late is its
    # own callout. Absent = active members with no row today.
    present_total = present + incomplete
    showed_up = present_total + late
    absent = max(0, total_members - showed_up)

    # On-site now: checked in but not yet checked out (no last_out, or last_out
    # earlier than first_in i.e. still incomplete) today.
    on_site_now = (
        db.query_one(
            """
            SELECT count(*) AS c
            FROM attendance_days a
            JOIN members m ON m.id = a.member_id AND m.status = 'active'
            WHERE a.work_date = %s
              AND a.first_in_ts IS NOT NULL
              AND (a.last_out_ts IS NULL OR a.last_out_ts <= a.first_in_ts)
            """,
            (today,),
        )
        or {"c": 0}
    )["c"]

    denied_today = (
        db.query_one(
            """
            SELECT count(*) AS c
            FROM access_events
            WHERE ts::date = %s
              AND decision IN ('denied','not_authorized','off_schedule','unknown_face')
            """,
            (today,),
        )
        or {"c": 0}
    )["c"]

    # Last granted entry today.
    last_in_row = db.query_one(
        """
        SELECT e.id, e.ts, e.member_id, m.full_name AS member_name, e.subject_name,
               e.similarity, e.door_id, d.name AS door_name, e.direction,
               e.decision, e.reason, e.snapshot_path
        FROM access_events e
        LEFT JOIN members m ON m.id = e.member_id
        LEFT JOIN doors   d ON d.id = e.door_id
        WHERE e.decision = 'granted' AND e.ts::date = %s
        ORDER BY e.ts DESC
        LIMIT 1
        """,
        (today,),
    )
    last_in: Optional[AccessEvent] = None
    if last_in_row:
        last_in = AccessEvent(
            id=last_in_row["id"],
            ts=last_in_row["ts"],
            member_id=str(last_in_row["member_id"]) if last_in_row.get("member_id") else None,
            member_name=last_in_row.get("member_name"),
            subject_name=last_in_row.get("subject_name"),
            similarity=float(last_in_row["similarity"]) if last_in_row.get("similarity") is not None else None,
            door_id=str(last_in_row["door_id"]) if last_in_row.get("door_id") else None,
            door_name=last_in_row.get("door_name"),
            direction=last_in_row.get("direction") or "unknown",
            decision=last_in_row["decision"],
            reason=last_in_row.get("reason"),
            snapshot_url=media.public_url(last_in_row.get("snapshot_path")),
        )

    # Hourly histogram of granted entries (local hour).
    hourly_rows = db.query_all(
        """
        SELECT EXTRACT(HOUR FROM e.ts AT TIME ZONE %s)::int AS hour, count(*) AS count
        FROM access_events e
        WHERE e.decision = 'granted'
          AND (e.ts AT TIME ZONE %s)::date = %s
        GROUP BY hour
        ORDER BY hour
        """,
        (tz_name, tz_name, today),
    )
    by_hour = {int(r["hour"]): int(r["count"]) for r in hourly_rows}
    hourly = [HourlyBucket(hour=h, count=by_hour.get(h, 0)) for h in range(24)]

    return StatsToday(
        present=present_total,
        late=late,
        absent=absent,
        on_site_now=on_site_now,
        denied_today=denied_today,
        total_members=total_members,
        last_in=last_in,
        hourly=hourly,
    )


@router.get("/today", response_model=StatsToday)
async def stats_today(_user: dict = Depends(security.get_current_user)) -> StatsToday:
    return await run_in_threadpool(_compute_today)
