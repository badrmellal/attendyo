"""Energy router — occupancy-driven automation rules + savings tally.

* ``GET/POST /api/energy/rules``          → list / create (operator+ create)
* ``PATCH/DELETE /api/energy/rules/{id}`` → mutate (operator+)
* ``GET /api/energy/summary?period=``     → savings card data (any authed user)

Rules switch a zone's connected load OFF when the zone empties and back ON on
the next granted entry (see :mod:`app.services.energy`). ``state`` is machine-
managed by the evaluator / recognize hook and is therefore never settable
through the API. Savings are ``Σ zone.energy_kw × hours-off`` over the period,
read from ``energy_log`` episodes.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

from ..core import audit, db, security
from ..models.schemas import (
    EnergyRule,
    EnergyRuleCreate,
    EnergyRuleSummary,
    EnergyRuleUpdate,
    EnergySummary,
)

logger = logging.getLogger("attendyo.energy.router")

router = APIRouter(prefix="/api/energy", tags=["energy"])

_RULE_COLUMNS = (
    "id, zone_id, name, empty_minutes, driver, driver_config, enabled, state, "
    "last_changed, created_at"
)


def _to_rule(row: dict[str, Any]) -> EnergyRule:
    cfg = row.get("driver_config")
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except ValueError:
            cfg = {}
    return EnergyRule(
        id=str(row["id"]),
        zone_id=str(row["zone_id"]),
        name=row["name"],
        empty_minutes=int(row["empty_minutes"]),
        driver=row["driver"],
        driver_config=cfg or {},
        enabled=row["enabled"],
        state=row["state"],
        last_changed=row.get("last_changed"),
        created_at=row["created_at"],
    )


# --------------------------------------------------------------------------- #
# Summary (declared before ``/rules/{id}`` so the literal path wins)
# --------------------------------------------------------------------------- #
def _period_start(period: Optional[str], today: dt.date) -> dt.date:
    p = (period or "month").lower()
    if p in ("today", "day"):
        return today
    if p == "week":
        return today - dt.timedelta(days=today.weekday())
    return today.replace(day=1)  # month-to-date (default)


def _compute_summary(period: Optional[str]) -> EnergySummary:
    today = dt.date.today()
    period_start = dt.datetime.combine(
        _period_start(period, today), dt.time.min, tzinfo=dt.timezone.utc
    )
    now = dt.datetime.now(dt.timezone.utc)

    all_rules = db.query_all("SELECT id, state FROM energy_rules")
    total = len(all_rules)
    off_now = sum(1 for r in all_rules if r["state"] == "off")

    rows = db.query_all(
        """
        SELECT r.id AS rule_id, r.name, r.state, z.name AS zone_name, z.energy_kw,
               l.went_off_at, l.back_on_at
        FROM energy_rules r
        JOIN zones z ON z.id = r.zone_id
        LEFT JOIN energy_log l ON l.rule_id = r.id
              AND l.went_off_at <= %s
              AND (l.back_on_at IS NULL OR l.back_on_at >= %s)
        ORDER BY r.created_at
        """,
        (now, period_start),
    )

    per: dict[str, dict[str, Any]] = {}
    for r in rows:
        rid = str(r["rule_id"])
        entry = per.setdefault(
            rid,
            {
                "name": r["name"],
                "zone_name": r["zone_name"],
                "state": r["state"],
                "energy_kw": float(r["energy_kw"]) if r["energy_kw"] is not None else 0.0,
                "seconds": 0.0,
            },
        )
        if r["went_off_at"] is not None:
            start = max(r["went_off_at"], period_start)
            end = min(r["back_on_at"] or now, now)
            secs = (end - start).total_seconds()
            if secs > 0:
                entry["seconds"] += secs

    per_rule: list[EnergyRuleSummary] = []
    total_hours = 0.0
    total_kwh = 0.0
    for rid, e in per.items():
        hours = e["seconds"] / 3600.0
        kwh = hours * e["energy_kw"]
        total_hours += hours
        total_kwh += kwh
        per_rule.append(
            EnergyRuleSummary(
                rule_id=rid,
                name=e["name"],
                zone_name=e["zone_name"],
                state=e["state"],
                hours_off=round(hours, 2),
                kwh_saved=round(kwh, 2),
            )
        )
    per_rule.sort(key=lambda x: x.kwh_saved, reverse=True)

    return EnergySummary(
        rules=total,
        off_now=off_now,
        hours_off=round(total_hours, 2),
        kwh_saved=round(total_kwh, 2),
        per_rule=per_rule,
    )


@router.get("/summary", response_model=EnergySummary)
async def energy_summary(
    period: Optional[str] = Query(None, description="today | week | month (default)"),
    _user: dict = Depends(security.get_current_user),
) -> EnergySummary:
    """kWh-saved tally over the period, plus per-rule breakdown."""
    return await run_in_threadpool(_compute_summary, period)


# --------------------------------------------------------------------------- #
# Rules CRUD
# --------------------------------------------------------------------------- #
@router.get("/rules", response_model=list[EnergyRule])
async def list_rules(_user: dict = Depends(security.get_current_user)) -> list[EnergyRule]:
    rows = await run_in_threadpool(
        db.query_all, f"SELECT {_RULE_COLUMNS} FROM energy_rules ORDER BY created_at ASC"
    )
    return [_to_rule(r) for r in rows]


@router.post("/rules", response_model=EnergyRule, status_code=status.HTTP_201_CREATED)
async def create_rule(
    payload: EnergyRuleCreate,
    user: dict = Depends(security.require_operator),
) -> EnergyRule:
    zone = await run_in_threadpool(
        db.query_one, "SELECT id FROM zones WHERE id = %s", (payload.zone_id,)
    )
    if zone is None:
        raise HTTPException(status_code=422, detail="zone_id does not exist")
    row = await run_in_threadpool(
        db.execute_returning,
        f"""
        INSERT INTO energy_rules
            (zone_id, name, empty_minutes, driver, driver_config, enabled)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s)
        RETURNING {_RULE_COLUMNS}
        """,
        (
            payload.zone_id, payload.name, payload.empty_minutes, payload.driver,
            json.dumps(payload.driver_config), payload.enabled,
        ),
    )
    assert row is not None
    await run_in_threadpool(
        audit.record, user, "energy_rule.create", entity="energy_rule",
        entity_id=str(row["id"]), details={"name": payload.name},
    )
    return _to_rule(row)


@router.patch("/rules/{rule_id}", response_model=EnergyRule)
async def update_rule(
    rule_id: str,
    payload: EnergyRuleUpdate,
    user: dict = Depends(security.require_operator),
) -> EnergyRule:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        row = await run_in_threadpool(
            db.query_one, f"SELECT {_RULE_COLUMNS} FROM energy_rules WHERE id = %s", (rule_id,)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Energy rule not found")
        return _to_rule(row)

    set_parts: list[str] = []
    params: list[Any] = []
    for col, val in updates.items():
        if col == "driver_config":
            set_parts.append("driver_config = %s::jsonb")
            params.append(json.dumps(val))
        else:
            set_parts.append(f"{col} = %s")
            params.append(val)
    params.append(rule_id)
    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE energy_rules SET {', '.join(set_parts)} WHERE id = %s RETURNING {_RULE_COLUMNS}",
        params,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Energy rule not found")
    await run_in_threadpool(
        audit.record, user, "energy_rule.update", entity="energy_rule",
        entity_id=rule_id, details={"fields": sorted(updates.keys())},
    )
    return _to_rule(row)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_rule(
    rule_id: str,
    user: dict = Depends(security.require_operator),
) -> None:
    affected = await run_in_threadpool(
        db.execute, "DELETE FROM energy_rules WHERE id = %s", (rule_id,)
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Energy rule not found")
    await run_in_threadpool(
        audit.record, user, "energy_rule.delete", entity="energy_rule", entity_id=rule_id,
    )
    return None
