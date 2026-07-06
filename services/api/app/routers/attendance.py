"""Attendance router.

Contract endpoints:
* ``GET /api/attendance?date=YYYY-MM-DD``                 → all members for a day
  (**absent members included**).
* ``GET /api/attendance?from=&to=&member_id=``           → range (only days with a row).
* ``GET /api/attendance/export.csv?date=`` (or from/to)  → streaming text/csv.
* ``GET /api/attendance/{member_id}?from=&to=``          → one person's history.

For a single ``date`` query we left-join every active member so people who never
showed up appear as ``status: "absent"`` — exactly what HR needs for the daily
sheet. Range and per-member queries return only materialised days.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import AttendanceDay

logger = logging.getLogger("attendyo.attendance.router")

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


def _row_to_day(row: dict[str, Any]) -> AttendanceDay:
    return AttendanceDay(
        member_id=str(row["member_id"]),
        member_name=row["member_name"],
        department=row.get("department"),
        work_date=row["work_date"],
        first_in_ts=row.get("first_in_ts"),
        last_out_ts=row.get("last_out_ts"),
        worked_seconds=row.get("worked_seconds"),
        is_late=bool(row.get("is_late", False)),
        status=row["status"],
    )


def _query_day_all_members(work_date: dt.date) -> list[dict[str, Any]]:
    """Every active member for ``work_date``; absent ones synthesised."""
    return db.query_all(
        """
        SELECT m.id AS member_id,
               m.full_name AS member_name,
               m.department AS department,
               %s::date AS work_date,
               a.first_in_ts,
               a.last_out_ts,
               a.worked_seconds,
               COALESCE(a.is_late, FALSE) AS is_late,
               COALESCE(a.status, 'absent') AS status
        FROM members m
        LEFT JOIN attendance_days a
               ON a.member_id = m.id AND a.work_date = %s::date
        WHERE m.status = 'active'
        ORDER BY m.full_name ASC
        """,
        (work_date, work_date),
    )


def _query_range(
    date_from: dt.date,
    date_to: dt.date,
    member_id: Optional[str],
) -> list[dict[str, Any]]:
    """Materialised attendance rows in a date range, optionally per member."""
    clauses = ["a.work_date BETWEEN %s AND %s"]
    params: list[Any] = [date_from, date_to]
    if member_id:
        clauses.append("a.member_id = %s")
        params.append(member_id)
    where = " AND ".join(clauses)
    return db.query_all(
        f"""
        SELECT a.member_id,
               m.full_name AS member_name,
               m.department AS department,
               a.work_date,
               a.first_in_ts,
               a.last_out_ts,
               a.worked_seconds,
               a.is_late,
               a.status
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id
        WHERE {where}
        ORDER BY a.work_date DESC, m.full_name ASC
        """,
        params,
    )


def _parse_date(value: str, field: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid {field} (YYYY-MM-DD)") from exc


@router.get("", response_model=list[AttendanceDay])
async def list_attendance(
    date: Optional[str] = Query(None, description="Single day YYYY-MM-DD"),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    _user: dict = Depends(security.get_current_user),
) -> list[AttendanceDay]:
    """List attendance for a single date (absent included) or a date range."""
    if date:
        work_date = _parse_date(date, "date")
        rows = await run_in_threadpool(_query_day_all_members, work_date)
        return [_row_to_day(r) for r in rows]

    # Range mode. Default the window to the last 30 days if unspecified.
    today = dt.date.today()
    date_from = _parse_date(from_, "from") if from_ else today - dt.timedelta(days=30)
    date_to = _parse_date(to, "to") if to else today
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="'from' must be <= 'to'")
    rows = await run_in_threadpool(_query_range, date_from, date_to, member_id)
    return [_row_to_day(r) for r in rows]


@router.get("/export.csv")
async def export_csv(
    date: Optional[str] = Query(None),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    _user: dict = Depends(security.get_current_user_flex),
) -> StreamingResponse:
    """Stream attendance as CSV. Same selection semantics as the list endpoint.

    Uses ``get_current_user_flex`` so a browser download (``window.open`` with
    ``?token=``) authenticates without an ``Authorization`` header.
    """
    if date:
        work_date = _parse_date(date, "date")
        rows = await run_in_threadpool(_query_day_all_members, work_date)
        fname = f"attendance-{work_date.isoformat()}.csv"
    else:
        today = dt.date.today()
        date_from = _parse_date(from_, "from") if from_ else today - dt.timedelta(days=30)
        date_to = _parse_date(to, "to") if to else today
        if date_from > date_to:
            raise HTTPException(status_code=422, detail="'from' must be <= 'to'")
        rows = await run_in_threadpool(_query_range, date_from, date_to, member_id)
        fname = f"attendance-{date_from.isoformat()}_{date_to.isoformat()}.csv"

    def _generate() -> Any:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "member_id", "member_name", "department", "work_date",
                "first_in_ts", "last_out_ts", "worked_seconds", "worked_hours",
                "is_late", "status",
            ]
        )
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for r in rows:
            worked = r.get("worked_seconds")
            writer.writerow(
                [
                    r["member_id"],
                    r["member_name"],
                    r.get("department") or "",
                    r["work_date"].isoformat() if hasattr(r["work_date"], "isoformat") else r["work_date"],
                    r["first_in_ts"].isoformat() if r.get("first_in_ts") else "",
                    r["last_out_ts"].isoformat() if r.get("last_out_ts") else "",
                    worked if worked is not None else "",
                    f"{worked / 3600:.2f}" if worked is not None else "",
                    "yes" if r.get("is_late") else "no",
                    r["status"],
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


@router.get("/{member_id}", response_model=list[AttendanceDay])
async def member_history(
    member_id: str,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    _user: dict = Depends(security.get_current_user),
) -> list[AttendanceDay]:
    """One member's attendance history over a range (default last 30 days)."""
    exists = await run_in_threadpool(
        db.query_one, "SELECT 1 FROM members WHERE id = %s", (member_id,)
    )
    if exists is None:
        raise HTTPException(status_code=404, detail="Member not found")

    today = dt.date.today()
    date_from = _parse_date(from_, "from") if from_ else today - dt.timedelta(days=30)
    date_to = _parse_date(to, "to") if to else today
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="'from' must be <= 'to'")
    rows = await run_in_threadpool(_query_range, date_from, date_to, member_id)
    return [_row_to_day(r) for r in rows]
