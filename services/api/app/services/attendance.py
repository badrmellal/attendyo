"""Attendance roll-up.

Maintains one ``attendance_days`` row per member per day, following the contract:

* Strategy ``first_in_last_out`` (default): the day's first ``granted`` event sets
  ``first_in_ts`` (+ door); the last ``granted`` event sets ``last_out_ts`` (+ door).
  ``worked_seconds = last_out_ts − first_in_ts``.
* ``is_late`` when ``first_in_ts > site.workday_start + grace_minutes`` (in the
  site timezone).
* Direction-aware doors refine in/out; single-door sites fall back to first/last.

Status semantics used across the API:
* ``present``    — has a first_in and a distinct last_out (a full in/out pair).
* ``incomplete`` — checked in but only one event so far (still on-site / no exit).
* ``late``       — like present/incomplete but first_in was after the grace window.
* ``absent``     — no granted event that day (materialised by the read layer, not
  stored here).

This module only ever *upserts* a row for a member who actually showed up. The
"absent" rows are synthesised by the attendance router when listing a date, so we
never write speculative rows for everyone every day.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any, Optional

from ..core import db

logger = logging.getLogger("attendyo.attendance")


def _site_for_door(door_id: Optional[str]) -> Optional[dict[str, Any]]:
    """Resolve the site (for workday_start/grace/timezone) from a door."""
    if door_id:
        site = db.query_one(
            """
            SELECT s.id, s.timezone, s.workday_start, s.grace_minutes
            FROM doors d JOIN sites s ON s.id = d.site_id
            WHERE d.id = %s
            """,
            (door_id,),
        )
        if site:
            return site
    # Fall back to the first configured site (single-site is the common case).
    return db.query_one(
        "SELECT id, timezone, workday_start, grace_minutes FROM sites ORDER BY created_at LIMIT 1"
    )


def grant_context(member_id: str, door_id: Optional[str]) -> dict[str, Any]:
    """Site-local context for one granted recognition (sync; call in a thread).

    Returns ``{"tz_name", "local_now", "work_date", "on_site"}``. ``on_site``
    is a **toggle on the member's most recent granted event today**: last
    effective direction was an entry (``in`` — or legacy ``unknown``, which
    only pre-v2.1 events carry) ⇒ inside; ``out`` ⇒ outside; no event today ⇒
    outside. This is what direction inference needs (both/no door → on-site ⇒
    "out" else "in"): unlike the first-in/last-out attendance pair, it keeps
    alternating correctly across midday exits and re-entries — the pair-based
    notion goes permanently "off-site" after the first exit of the day, which
    made the kiosk greet a real exit with "Bienvenue" again. Also used for
    time-aware greetings and the soft anti-passback check.
    """
    site = _site_for_door(door_id)
    tz_name = (site or {}).get("timezone") or "Africa/Casablanca"
    try:
        from zoneinfo import ZoneInfo

        local_now = dt.datetime.now(ZoneInfo(tz_name))
    except Exception:  # pragma: no cover - bad tz name in DB
        local_now = dt.datetime.now()
    work_date = local_now.date()

    last = db.query_one(
        """
        SELECT direction
        FROM access_events
        WHERE member_id = %s
          AND decision = 'granted'
          AND ts >= %s::date
        ORDER BY ts DESC
        LIMIT 1
        """,
        (member_id, work_date),
    )
    return {
        "tz_name": tz_name,
        "local_now": local_now,
        "work_date": work_date,
        "on_site": last is not None and (last.get("direction") or "unknown") != "out",
    }


def today_row(member_id: str, work_date: dt.date) -> Optional[dict[str, Any]]:
    """Fetch the member's attendance row for ``work_date`` (sync)."""
    return db.query_one(
        """
        SELECT member_id, work_date, first_in_ts, last_out_ts, worked_seconds,
               is_late, status
        FROM attendance_days
        WHERE member_id = %s AND work_date = %s
        """,
        (member_id, work_date),
    )


def record_granted_event(
    *,
    member_id: str,
    event_ts: dt.datetime,
    direction: str,
    door_id: Optional[str],
) -> dict[str, Any]:
    """Fold one granted access event into the member's attendance day.

    Returns the resulting ``attendance_days`` row. Idempotent-friendly: re-folding
    the same timestamps yields the same row. Computes ``work_date`` in the site's
    local timezone so a 00:30 exit still belongs to the prior workday only if the
    timezone places it there (we use local civil date).
    """
    site = _site_for_door(door_id)
    site_id = site["id"] if site else None
    tz_name = (site or {}).get("timezone") or "Africa/Casablanca"

    # Local civil date + late computation in the site timezone.
    try:
        from zoneinfo import ZoneInfo

        local_ts = event_ts.astimezone(ZoneInfo(tz_name))
    except Exception:  # pragma: no cover - bad tz name
        local_ts = event_ts
    work_date = local_ts.date()

    # Determine in/out contribution.
    # Direction-aware doors: 'in' updates first_in, 'out' updates last_out.
    # Otherwise (both/unknown): first event of the day is first_in, every later
    # event extends last_out.
    is_in = direction == "in"
    is_out = direction == "out"

    existing = db.query_one(
        """
        SELECT id, first_in_ts, last_out_ts, first_in_door, last_out_door
        FROM attendance_days
        WHERE member_id = %s AND work_date = %s
        """,
        (member_id, work_date),
    )

    if existing is None:
        first_in_ts = event_ts if not is_out else None
        first_in_door = door_id if not is_out else None
        last_out_ts = event_ts if is_out else None
        last_out_door = door_id if is_out else None
    else:
        first_in_ts = existing["first_in_ts"]
        first_in_door = existing["first_in_door"]
        last_out_ts = existing["last_out_ts"]
        last_out_door = existing["last_out_door"]

        if is_in:
            if first_in_ts is None or event_ts < first_in_ts:
                first_in_ts, first_in_door = event_ts, door_id
        elif is_out:
            if last_out_ts is None or event_ts > last_out_ts:
                last_out_ts, last_out_door = event_ts, door_id
        else:
            # Non-directional: earliest = in, latest = out.
            if first_in_ts is None or event_ts < first_in_ts:
                first_in_ts, first_in_door = event_ts, door_id
            if event_ts > (first_in_ts or event_ts):
                if last_out_ts is None or event_ts > last_out_ts:
                    last_out_ts, last_out_door = event_ts, door_id

    worked_seconds, is_late, status = _derive(
        first_in_ts, last_out_ts, site, tz_name
    )

    row = db.execute_returning(
        """
        INSERT INTO attendance_days
            (member_id, work_date, site_id, first_in_ts, last_out_ts,
             first_in_door, last_out_door, worked_seconds, is_late, status, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (member_id, work_date) DO UPDATE SET
            first_in_ts    = EXCLUDED.first_in_ts,
            last_out_ts    = EXCLUDED.last_out_ts,
            first_in_door  = EXCLUDED.first_in_door,
            last_out_door  = EXCLUDED.last_out_door,
            worked_seconds = EXCLUDED.worked_seconds,
            is_late        = EXCLUDED.is_late,
            status         = EXCLUDED.status,
            site_id        = COALESCE(EXCLUDED.site_id, attendance_days.site_id),
            updated_at     = now()
        RETURNING member_id, work_date, first_in_ts, last_out_ts, worked_seconds,
                  is_late, status
        """,
        (
            member_id, work_date, site_id, first_in_ts, last_out_ts,
            first_in_door, last_out_door, worked_seconds, is_late, status,
        ),
    )
    assert row is not None  # INSERT ... RETURNING always yields a row
    return row


def _derive(
    first_in_ts: Optional[dt.datetime],
    last_out_ts: Optional[dt.datetime],
    site: Optional[dict[str, Any]],
    tz_name: str,
) -> tuple[Optional[int], bool, str]:
    """Compute (worked_seconds, is_late, status) from the in/out timestamps."""
    worked_seconds: Optional[int] = None
    if first_in_ts and last_out_ts and last_out_ts > first_in_ts:
        worked_seconds = int((last_out_ts - first_in_ts).total_seconds())

    is_late = _compute_late(first_in_ts, site, tz_name)

    if first_in_ts and last_out_ts and last_out_ts > first_in_ts:
        status = "late" if is_late else "present"
    elif first_in_ts or last_out_ts:
        # Checked in but no closing exit yet (or only an exit seen).
        status = "late" if is_late else "incomplete"
    else:  # pragma: no cover - should not happen for a granted event
        status = "absent"
    return worked_seconds, is_late, status


def _compute_late(
    first_in_ts: Optional[dt.datetime],
    site: Optional[dict[str, Any]],
    tz_name: str,
) -> bool:
    """True if first_in is after ``workday_start + grace_minutes`` (site-local)."""
    if first_in_ts is None or site is None:
        return False
    workday_start = site.get("workday_start")  # datetime.time
    grace = int(site.get("grace_minutes") or 0)
    if workday_start is None:
        return False
    try:
        from zoneinfo import ZoneInfo

        local = first_in_ts.astimezone(ZoneInfo(tz_name))
    except Exception:  # pragma: no cover
        local = first_in_ts

    cutoff = dt.datetime.combine(local.date(), workday_start) + dt.timedelta(minutes=grace)
    # Compare naive local wall-clock times.
    local_naive = local.replace(tzinfo=None)
    return local_naive > cutoff
