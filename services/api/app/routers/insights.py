"""Insights router — "{product} IQ" (Smart Gate v2.1).

* ``GET /api/insights?limit=`` → ``{ insights: Insight[] }``

Local behavioural intelligence computed from ``attendance_days`` (last 30
days, site-local dates) — pure SQL + stdlib stats on the box: no cloud, no ML
dependencies, nothing stored. Deterministic and idempotent: the same data
always yields the same insights.

Four kinds (contract):
* ``unusual_arrival``    — member arrived today ≥60 min later than their own
                           30-day median first-in time (and today they are
                           beyond grace, i.e. late).
* ``absence_streak``     — member absent ≥3 consecutive workdays (Mon-Fri) up
                           to today.
* ``punctuality_streak`` — member present-and-on-time ≥10 consecutive
                           workdays (celebrate it).
* ``record_presence``    — today's present count is the 30-day high
                           (site-level, at most one).

Texts are built server-side in FR, consistent with alert messages. Readable by
any authenticated console user (operator/viewer), like reports. Sort: today's
anomalies first, then streaks.
"""

from __future__ import annotations

import datetime as dt
import logging
import statistics
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import Insight, InsightsOut

logger = logging.getLogger("attendyo.insights")

router = APIRouter(prefix="/api/insights", tags=["insights"])

_WINDOW_DAYS = 30
# Minimum prior arrivals for a meaningful personal median (unusual_arrival).
_MIN_HISTORY_DAYS = 5
_ABSENCE_STREAK_MIN = 3
_PUNCTUALITY_STREAK_MIN = 10


def _site_tz() -> Any:
    """ZoneInfo of the first configured site (single-site is the common case)."""
    row = db.query_one("SELECT timezone FROM sites ORDER BY created_at LIMIT 1")
    tz_name = (row or {}).get("timezone") or "Africa/Casablanca"
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(tz_name)
    except Exception:  # pragma: no cover - bad tz name in DB
        return dt.timezone.utc


def _is_workday(d: dt.date) -> bool:
    return d.weekday() < 5  # Mon-Fri


def _fmt_delta_fr(minutes: int) -> str:
    """'1 h 20' — the FR duration format used across kiosk/alert texts."""
    hours, mins = divmod(int(minutes), 60)
    return f"{hours} h {mins:02d}"


def _local_minutes(ts: dt.datetime, tz: Any) -> int:
    """Minutes since site-local midnight for a tz-aware timestamp."""
    local = ts.astimezone(tz) if ts.tzinfo else ts
    return local.hour * 60 + local.minute


def _compute_insights(limit: int) -> list[Insight]:
    tz = _site_tz()
    today = dt.datetime.now(tz).date()
    window_start = today - dt.timedelta(days=_WINDOW_DAYS - 1)

    members = db.query_all(
        """
        SELECT id, full_name, department, created_at
        FROM members
        WHERE status = 'active'
        ORDER BY full_name
        """
    )
    rows = db.query_all(
        """
        SELECT a.member_id, a.work_date, a.first_in_ts, a.is_late
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date BETWEEN %s AND %s
        ORDER BY a.work_date
        """,
        (window_start, today),
    )

    # Index attendance by member for the per-person passes.
    by_member: dict[str, dict[dt.date, dict[str, Any]]] = {}
    for r in rows:
        by_member.setdefault(str(r["member_id"]), {})[r["work_date"]] = r

    unusual: list[tuple[int, Insight]] = []
    absences: list[tuple[int, Insight]] = []
    punctual: list[tuple[int, Insight]] = []

    for m in members:
        member_id = str(m["id"])
        name = m["full_name"]
        department = m.get("department")
        created = m["created_at"]
        created_date = (
            created.astimezone(tz).date()
            if isinstance(created, dt.datetime) and created.tzinfo
            else (created.date() if isinstance(created, dt.datetime) else created)
        )
        days = by_member.get(member_id, {})
        today_row = days.get(today)

        # ---- unusual_arrival ------------------------------------------------ #
        if today_row and today_row.get("first_in_ts") and today_row.get("is_late"):
            history = [
                _local_minutes(r["first_in_ts"], tz)
                for d, r in days.items()
                if d < today and r.get("first_in_ts")
            ]
            if len(history) >= _MIN_HISTORY_DAYS:
                median = statistics.median(history)
                delta = _local_minutes(today_row["first_in_ts"], tz) - median
                if delta >= 60:
                    delta_i = int(delta)
                    unusual.append((
                        delta_i,
                        Insight(
                            kind="unusual_arrival",
                            member_id=member_id,
                            member_name=name,
                            department=department,
                            text=(
                                f"{name} est arrivé {_fmt_delta_fr(delta_i)} "
                                "plus tard que son habitude."
                            ),
                            date=today,
                        ),
                    ))

        # ---- absence_streak (consecutive workdays with no row) -------------- #
        if today_row is None:
            streak = 0
            first_absent: Optional[dt.date] = None
            d = today
            while d >= window_start:
                if _is_workday(d):
                    if d in days:
                        break
                    streak += 1
                    first_absent = d
                d -= dt.timedelta(days=1)
            # Only count members who existed for the whole streak.
            if (
                streak >= _ABSENCE_STREAK_MIN
                and first_absent is not None
                and created_date <= first_absent
            ):
                absences.append((
                    streak,
                    Insight(
                        kind="absence_streak",
                        member_id=member_id,
                        member_name=name,
                        department=department,
                        text=f"{name} est absent(e) depuis {streak} jours ouvrés.",
                        date=today,
                    ),
                ))

        # ---- punctuality_streak (consecutive on-time workdays) -------------- #
        # Start from today when a row exists; otherwise from the previous
        # workday (an employee who has not badged in *yet* keeps their streak).
        d = today if today_row is not None else today - dt.timedelta(days=1)
        streak = 0
        broken = False
        while d >= window_start and not broken:
            if _is_workday(d):
                r = days.get(d)
                if r and r.get("first_in_ts") and not r.get("is_late"):
                    streak += 1
                else:
                    broken = True
            d -= dt.timedelta(days=1)
        if streak >= _PUNCTUALITY_STREAK_MIN:
            punctual.append((
                streak,
                Insight(
                    kind="punctuality_streak",
                    member_id=member_id,
                    member_name=name,
                    department=department,
                    text=(
                        f"{name} est à l'heure depuis {streak} jours ouvrés "
                        "consécutifs."
                    ),
                    date=today,
                ),
            ))

    # ---- record_presence (site-level, at most one) --------------------------- #
    record: list[Insight] = []
    per_day: dict[dt.date, int] = {}
    for r in rows:
        if r.get("first_in_ts"):
            per_day[r["work_date"]] = per_day.get(r["work_date"], 0) + 1
    today_count = per_day.get(today, 0)
    prior_max = max((c for d, c in per_day.items() if d < today), default=0)
    if today_count > 0 and today_count > prior_max:
        record.append(
            Insight(
                kind="record_presence",
                text=(
                    f"Record de présence : {today_count} personnes sur site "
                    "aujourd'hui — plus haut niveau sur 30 jours."
                ),
                date=today,
            )
        )

    # Sort: today's anomalies first (largest deviation first), then streaks
    # (longest first); names break ties so the output is deterministic.
    def _ranked(items: list[tuple[int, Insight]]) -> list[Insight]:
        return [i for _, i in sorted(items, key=lambda t: (-t[0], t[1].member_name or ""))]

    ordered: list[Insight] = (
        _ranked(unusual) + record + _ranked(absences) + _ranked(punctual)
    )
    return ordered[:limit]


@router.get("", response_model=InsightsOut)
async def list_insights(
    limit: int = Query(20, ge=1, le=100),
    _user: dict = Depends(security.get_current_user),
) -> InsightsOut:
    """Compute and return the current insights (nothing is stored)."""
    insights = await run_in_threadpool(_compute_insights, limit)
    return InsightsOut(insights=insights)
