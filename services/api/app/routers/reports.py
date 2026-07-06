"""Reports & analytics router (v2).

* ``GET /api/reports/summary?from&to``      → range averages + per-day series
* ``GET /api/reports/departments?from&to``  → per-department aggregates
* ``GET /api/reports/members?from&to&sort&limit`` → per-member aggregates
* ``GET /api/reports/export.csv?from&to``   → per-member aggregate CSV
  (accepts ``?token=`` for browser downloads)

Semantics (mirrors the attendance read layer):
* A member counts as **present** on a day when their ``attendance_days`` row has
  status ``present`` or ``incomplete`` (they showed up; ``late`` is its own
  bucket).
* **Absent** = active member with no ``attendance_days`` row that day.
* ``punctuality_rate`` = on-time arrivals / total arrivals over the range
  (fraction 0..1; 1.0 when there were no arrivals at all).
* Averages are per day in the range (inclusive), so quiet weekends pull the
  averages down honestly rather than being silently skipped.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging
from typing import Iterator, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import (
    DepartmentReport,
    MemberReport,
    ReportDailyBucket,
    ReportSummary,
)

logger = logging.getLogger("attendyo.reports")

router = APIRouter(prefix="/api/reports", tags=["reports"])

_MAX_RANGE_DAYS = 366  # guard against accidental multi-year scans


def _parse_range(from_: Optional[str], to: Optional[str]) -> tuple[dt.date, dt.date]:
    """Resolve the inclusive [from, to] window; defaults to the last 30 days."""
    today = dt.date.today()
    try:
        date_from = dt.date.fromisoformat(from_) if from_ else today - dt.timedelta(days=30)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid 'from' (YYYY-MM-DD)") from exc
    try:
        date_to = dt.date.fromisoformat(to) if to else today
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid 'to' (YYYY-MM-DD)") from exc
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="'from' must be <= 'to'")
    if (date_to - date_from).days + 1 > _MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Range exceeds {_MAX_RANGE_DAYS} days")
    return date_from, date_to


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #
def _compute_summary(date_from: dt.date, date_to: dt.date) -> ReportSummary:
    n_days = (date_to - date_from).days + 1
    active_members = int(
        (db.query_one("SELECT count(*) AS c FROM members WHERE status = 'active'") or {"c": 0})["c"]
    )

    # Per-day counts of rows by status (active members only).
    day_rows = db.query_all(
        """
        SELECT a.work_date,
               count(*) FILTER (WHERE a.status IN ('present','incomplete')) AS present,
               count(*) FILTER (WHERE a.status = 'late')                    AS late,
               count(*)                                                     AS total_rows
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date BETWEEN %s AND %s
        GROUP BY a.work_date
        """,
        (date_from, date_to),
    )
    by_date = {r["work_date"]: r for r in day_rows}

    daily: list[ReportDailyBucket] = []
    for offset in range(n_days):
        day = date_from + dt.timedelta(days=offset)
        r = by_date.get(day)
        present = int(r["present"]) if r else 0
        late = int(r["late"]) if r else 0
        showed_up = int(r["total_rows"]) if r else 0
        daily.append(
            ReportDailyBucket(
                date=day,
                present=present,
                late=late,
                absent=max(0, active_members - showed_up),
            )
        )

    # Punctuality + worked-time over the whole range in one pass.
    agg = db.query_one(
        """
        SELECT count(*) FILTER (WHERE NOT a.is_late)          AS on_time,
               count(*)                                        AS arrivals,
               COALESCE(avg(a.worked_seconds), 0)::float       AS avg_worked
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date BETWEEN %s AND %s
        """,
        (date_from, date_to),
    ) or {"on_time": 0, "arrivals": 0, "avg_worked": 0.0}
    arrivals = int(agg["arrivals"] or 0)
    punctuality = (int(agg["on_time"] or 0) / arrivals) if arrivals else 1.0

    return ReportSummary(
        days=n_days,
        avg_present=round(sum(d.present for d in daily) / n_days, 2),
        avg_late=round(sum(d.late for d in daily) / n_days, 2),
        avg_absent=round(sum(d.absent for d in daily) / n_days, 2),
        punctuality_rate=round(punctuality, 4),
        avg_worked_seconds=round(float(agg["avg_worked"] or 0.0), 1),
        daily=daily,
    )


@router.get("/summary", response_model=ReportSummary)
async def report_summary(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    _user: dict = Depends(security.get_current_user),
) -> ReportSummary:
    """Range-wide attendance averages plus a per-day series for charts."""
    date_from, date_to = _parse_range(from_, to)
    return await run_in_threadpool(_compute_summary, date_from, date_to)


# --------------------------------------------------------------------------- #
# Departments
# --------------------------------------------------------------------------- #
def _compute_departments(date_from: dt.date, date_to: dt.date) -> list[DepartmentReport]:
    n_days = (date_to - date_from).days + 1
    rows = db.query_all(
        """
        SELECT COALESCE(m.department, '—') AS department,
               count(DISTINCT m.id) AS members,
               count(a.id) FILTER (WHERE a.status IN ('present','incomplete')) AS present_days,
               count(a.id) FILTER (WHERE a.status = 'late')                    AS late_days,
               count(a.id)                                                     AS total_rows,
               COALESCE(avg(a.worked_seconds), 0)::float                       AS avg_worked
        FROM members m
        LEFT JOIN attendance_days a
               ON a.member_id = m.id AND a.work_date BETWEEN %s AND %s
        WHERE m.status = 'active'
        GROUP BY COALESCE(m.department, '—')
        ORDER BY department ASC
        """,
        (date_from, date_to),
    )
    out: list[DepartmentReport] = []
    for r in rows:
        members = int(r["members"])
        total_rows = int(r["total_rows"] or 0)
        out.append(
            DepartmentReport(
                department=r["department"],
                members=members,
                present_days=int(r["present_days"] or 0),
                late_days=int(r["late_days"] or 0),
                absent_days=max(0, members * n_days - total_rows),
                avg_worked_seconds=round(float(r["avg_worked"] or 0.0), 1),
            )
        )
    return out


@router.get("/departments", response_model=list[DepartmentReport])
async def report_departments(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    _user: dict = Depends(security.get_current_user),
) -> list[DepartmentReport]:
    """Attendance aggregates grouped by department over the range."""
    date_from, date_to = _parse_range(from_, to)
    return await run_in_threadpool(_compute_departments, date_from, date_to)


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #
_SORT_SQL = {
    "late": "late_days DESC, member_name ASC",
    "hours": "total_worked_seconds DESC, member_name ASC",
    "absences": "absent_days DESC, member_name ASC",
}


def _compute_members(
    date_from: dt.date, date_to: dt.date, sort: str, limit: int
) -> list[MemberReport]:
    n_days = (date_to - date_from).days + 1
    site = db.query_one("SELECT timezone FROM sites ORDER BY created_at LIMIT 1")
    tz_name = (site or {}).get("timezone") or "Africa/Casablanca"
    rows = db.query_all(
        f"""
        SELECT m.id AS member_id,
               m.full_name AS member_name,
               m.department,
               count(a.id) FILTER (WHERE a.status IN ('present','incomplete')) AS present_days,
               count(a.id) FILTER (WHERE a.status = 'late')                    AS late_days,
               (%s - count(a.id))::int                                         AS absent_days,
               -- Average local arrival time: mean interval-since-midnight of
               -- first_in_ts in the site timezone, rendered as HH:MM (NULL when
               -- the member never arrived in the range).
               to_char(
                   timestamp '2000-01-01'
                   + avg((a.first_in_ts AT TIME ZONE %s)::time - time '00:00'),
                   'HH24:MI'
               ) AS avg_arrival,
               COALESCE(sum(a.worked_seconds), 0)::bigint AS total_worked_seconds
        FROM members m
        LEFT JOIN attendance_days a
               ON a.member_id = m.id AND a.work_date BETWEEN %s AND %s
        WHERE m.status = 'active'
        GROUP BY m.id, m.full_name, m.department
        ORDER BY {_SORT_SQL[sort]}
        LIMIT %s
        """,
        (n_days, tz_name, date_from, date_to, limit),
    )
    return [
        MemberReport(
            member_id=str(r["member_id"]),
            member_name=r["member_name"],
            department=r.get("department"),
            present_days=int(r["present_days"] or 0),
            late_days=int(r["late_days"] or 0),
            absent_days=max(0, int(r["absent_days"] or 0)),
            avg_arrival=r.get("avg_arrival"),
            total_worked_seconds=int(r["total_worked_seconds"] or 0),
        )
        for r in rows
    ]


@router.get("/members", response_model=list[MemberReport])
async def report_members(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    sort: Literal["late", "hours", "absences"] = Query("late"),
    limit: int = Query(50, ge=1, le=1000),
    _user: dict = Depends(security.get_current_user),
) -> list[MemberReport]:
    """Per-member aggregates over the range, sortable by late/hours/absences."""
    date_from, date_to = _parse_range(from_, to)
    return await run_in_threadpool(_compute_members, date_from, date_to, sort, limit)


# --------------------------------------------------------------------------- #
# CSV export (per-member aggregates)
# --------------------------------------------------------------------------- #
@router.get("/export.csv")
async def report_export_csv(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    _user: dict = Depends(security.get_current_user_flex),
) -> StreamingResponse:
    """Per-member aggregate CSV over the range.

    Uses ``get_current_user_flex`` so a browser download (``window.open`` with
    ``?token=``) authenticates without an ``Authorization`` header.
    """
    date_from, date_to = _parse_range(from_, to)
    rows = await run_in_threadpool(
        _compute_members, date_from, date_to, "late", 100_000
    )
    fname = f"report-{date_from.isoformat()}_{date_to.isoformat()}.csv"

    def _generate() -> Iterator[str]:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "member_id", "member_name", "department", "present_days",
                "late_days", "absent_days", "avg_arrival",
                "total_worked_seconds", "total_worked_hours",
            ]
        )
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for r in rows:
            writer.writerow(
                [
                    r.member_id,
                    r.member_name,
                    r.department or "",
                    r.present_days,
                    r.late_days,
                    r.absent_days,
                    r.avg_arrival or "",
                    r.total_worked_seconds,
                    f"{r.total_worked_seconds / 3600:.2f}",
                ]
            )
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    return StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
