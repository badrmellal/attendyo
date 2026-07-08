"""Energy automation — occupancy-driven on/off signalling.

Honest scope (contract): Attendyo **emits** on/off signals to the buyer's own
relay / BMS endpoint (a LAN URL) or runs in ``simulation``. It is not itself an
HVAC controller.

Two triggers, both reusing the v3 spatial occupancy logic:

* **Empty → OFF** — a background loop (~60 s tick, started in ``main`` lifespan)
  finds every enabled rule whose zone (incl. its subtree) has been empty for at
  least ``empty_minutes`` while ``state='on'``, fires the driver OFF, flips the
  state and opens an ``energy_log`` episode.
* **Entry → ON** — the recognize hot path calls :func:`fire_on_for_zone`
  fire-and-forget on every granted entry; any ``off`` rule whose zone contains
  the door's zone is switched back ON immediately and its episode closed.

Every driver call is wrapped: **failures never raise into a caller** — a dead
relay must never break the loop or the recognition path. State only flips when
the driver reports success, so a transient failure is retried on the next tick /
entry rather than silently desynchronising the physical relay.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
from typing import Any

import httpx
from starlette.concurrency import run_in_threadpool

from ..core import db
from ..services import zones as zones_service

logger = logging.getLogger("attendyo.energy")

TICK_SECONDS = 60

_task: asyncio.Task | None = None

# Last granted event per zone (leaf), for the "empty this long" test.
_LAST_EVENT_SQL = """
    SELECT z.id AS zone_id, max(e.ts) AS last_ts
    FROM access_events e
    JOIN doors d ON d.id = e.door_id
    JOIN zones z ON z.id = d.zone_id
    WHERE e.decision = 'granted'
    GROUP BY z.id
"""


def _driver_config(rule: dict[str, Any]) -> dict[str, Any]:
    cfg = rule.get("driver_config")
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except ValueError:
            cfg = {}
    return cfg or {}


async def _fire_driver(rule: dict[str, Any], *, turn_on: bool) -> bool:
    """Emit an on/off signal for one rule. Never raises; returns success."""
    action = "ON" if turn_on else "OFF"
    driver = rule.get("driver") or "simulation"
    if driver != "webhook":
        # Simulation: no hardware, just log the intent (like the door sim driver).
        logger.info("ENERGY %s rule=%s zone=%s (simulation)", action,
                    rule.get("name"), rule.get("zone_id"))
        return True

    cfg = _driver_config(rule)
    url = cfg.get("url")
    if not url:
        logger.warning("Energy webhook rule %s has no url configured", rule.get("name"))
        return False
    method = str(cfg.get("method", "POST")).upper()
    body = cfg.get("on_on" if turn_on else "on_off") or {"action": action.lower()}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.request(method, url, json=body)
    except httpx.HTTPError as exc:
        logger.warning("Energy webhook rule %s unreachable: %s", rule.get("name"), exc)
        return False
    if resp.status_code >= 400:
        logger.warning("Energy webhook rule %s returned %s", rule.get("name"), resp.status_code)
        return False
    return True


# --------------------------------------------------------------------------- #
# State transitions (sync; call via run_in_threadpool)
# --------------------------------------------------------------------------- #
def _mark_off(rule_id: str) -> bool:
    """Flip on→off and open an energy_log episode. Idempotent via the guard."""
    updated = db.execute(
        "UPDATE energy_rules SET state = 'off', last_changed = now() "
        "WHERE id = %s AND state = 'on'",
        (rule_id,),
    )
    if updated:
        db.execute(
            "INSERT INTO energy_log (rule_id, went_off_at) VALUES (%s, now())",
            (rule_id,),
        )
    return updated > 0


def _mark_on(rule_id: str) -> bool:
    """Flip off→on and close the open energy_log episode. Idempotent via guard."""
    updated = db.execute(
        "UPDATE energy_rules SET state = 'on', last_changed = now() "
        "WHERE id = %s AND state = 'off'",
        (rule_id,),
    )
    if updated:
        db.execute(
            "UPDATE energy_log SET back_on_at = now() "
            "WHERE rule_id = %s AND back_on_at IS NULL",
            (rule_id,),
        )
    return updated > 0


# --------------------------------------------------------------------------- #
# Empty → OFF (evaluator loop)
# --------------------------------------------------------------------------- #
def _compute_rules_to_turn_off() -> list[dict[str, Any]]:
    """Enabled, currently-on rules whose zone subtree is empty long enough."""
    rules = db.query_all(
        "SELECT id, zone_id, name, empty_minutes, driver, driver_config, state "
        "FROM energy_rules WHERE enabled AND state = 'on'"
    )
    if not rules:
        return []
    zones = zones_service.all_zones()
    dmap = zones_service.descendants_map(zones)
    today = zones_service.site_local_today()
    people = zones_service.people_on_site(today)
    leaf_counts = zones_service.leaf_occupancy_counts(people)
    last_by_zone = {
        str(r["zone_id"]): r["last_ts"] for r in db.query_all(_LAST_EVENT_SQL)
    }
    now = dt.datetime.now(dt.timezone.utc)

    to_off: list[dict[str, Any]] = []
    for rule in rules:
        zid = str(rule["zone_id"])
        subtree = dmap.get(zid, {zid})
        occupancy = sum(leaf_counts.get(c, 0) for c in subtree)
        if occupancy != 0:
            continue
        last_ts = None
        for c in subtree:
            lt = last_by_zone.get(c)
            if lt and (last_ts is None or lt > last_ts):
                last_ts = lt
        empty_minutes = int(rule["empty_minutes"] or 0)
        if last_ts is None or (now - last_ts) >= dt.timedelta(minutes=empty_minutes):
            to_off.append(rule)
    return to_off


async def _evaluator_tick() -> None:
    to_off = await run_in_threadpool(_compute_rules_to_turn_off)
    for rule in to_off:
        if await _fire_driver(rule, turn_on=False):
            await run_in_threadpool(_mark_off, str(rule["id"]))


async def _evaluator_loop() -> None:
    logger.info("Energy evaluator started (tick=%ss)", TICK_SECONDS)
    while True:
        try:
            await _evaluator_tick()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # DB briefly down, etc. — no-op and retry.
            logger.warning("Energy evaluator tick failed (continuing): %s", exc)
        try:
            await asyncio.sleep(TICK_SECONDS)
        except asyncio.CancelledError:
            raise


async def start_evaluator() -> None:
    """Start the background evaluator (idempotent)."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_evaluator_loop())


async def stop_evaluator() -> None:
    """Cancel the background evaluator on shutdown."""
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover - defensive
            pass
        _task = None


# --------------------------------------------------------------------------- #
# Entry → ON (recognize hot-path hook)
# --------------------------------------------------------------------------- #
def _rules_to_turn_on_for_zone(door_zone_id: str) -> list[dict[str, Any]]:
    """Off, enabled rules whose zone is an ancestor-or-self of the door's zone."""
    if not door_zone_id:
        return []
    rules = db.query_all(
        "SELECT id, zone_id, name, driver, driver_config, state "
        "FROM energy_rules WHERE enabled AND state = 'off'"
    )
    if not rules:
        return []
    zones = zones_service.all_zones()
    dmap = zones_service.descendants_map(zones)
    door_zone = str(door_zone_id)
    return [
        rule
        for rule in rules
        if door_zone in dmap.get(str(rule["zone_id"]), {str(rule["zone_id"])})
    ]


async def fire_on_for_zone(door_zone_id: str) -> None:
    """Switch any off rule covering this zone back ON. Fire-and-forget; never
    raises — called from the recognize path, which must not block or break."""
    try:
        rules = await run_in_threadpool(_rules_to_turn_on_for_zone, door_zone_id)
        for rule in rules:
            if await _fire_driver(rule, turn_on=True):
                await run_in_threadpool(_mark_on, str(rule["id"]))
    except Exception as exc:  # pragma: no cover - hot path must never break
        logger.warning("Energy ON hook failed (ignored): %s", exc)


# Strong refs to in-flight ON tasks so the loop can't GC them mid-run.
_bg_tasks: set[asyncio.Task] = set()


def schedule_on(door_zone_id: str) -> None:
    """Fire :func:`fire_on_for_zone` as a background task (non-blocking).

    Safe to call synchronously from the recognize handler: it schedules the work
    on the running loop and returns immediately, never blocking the hot path or
    raising (no loop → no-op). A reference to the task is retained until it
    finishes so it is not garbage-collected mid-flight.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # pragma: no cover - no running loop (e.g. sync tests)
        return
    task = loop.create_task(fire_on_for_zone(str(door_zone_id)))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
