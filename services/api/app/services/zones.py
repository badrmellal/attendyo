"""Spatial helpers shared across the v3 routers.

The location chain is **camera → door → zone**: every granted recognition is a
location fix at zone granularity. This module centralises the read-side spatial
logic so presence, occupancy, the Ask engine and the energy evaluator all agree:

* :func:`site_local_today` — today's civil date in the site timezone.
* :func:`all_zones` / :func:`descendants_map` / :func:`subtree_ids` — the zone
  tree and its subtrees (a building includes its floors/areas).
* :func:`people_on_site` — everyone currently on site, each tagged with their
  **current zone** (the zone of the door of their most recent granted event
  today). This is the single canonical presence query.
* :func:`leaf_congestion_counts` — granted entries per zone in the last 15 min.

All functions are synchronous (psycopg2 is blocking); routers call them off the
event loop via ``run_in_threadpool``.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any, Optional

from ..core import db

logger = logging.getLogger("attendyo.zones")

# Congestion window: granted entries into a zone within this many minutes.
CONGESTION_WINDOW_MINUTES = 15


def site_local_today() -> dt.date:
    """Today in the first configured site's timezone (server date fallback)."""
    row = db.query_one("SELECT timezone FROM sites ORDER BY created_at LIMIT 1")
    tz_name = (row or {}).get("timezone") or "Africa/Casablanca"
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo(tz_name)).date()
    except Exception:  # pragma: no cover - bad tz name in DB
        return dt.date.today()


def all_zones() -> list[dict[str, Any]]:
    """Flat list of every zone with string ids (parent_id may be None)."""
    rows = db.query_all(
        "SELECT id, name, kind, parent_id, capacity, energy_kw, created_at "
        "FROM zones ORDER BY kind, name"
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": str(r["id"]),
                "name": r["name"],
                "kind": r["kind"],
                "parent_id": str(r["parent_id"]) if r.get("parent_id") else None,
                "capacity": r.get("capacity"),
                "energy_kw": (
                    float(r["energy_kw"]) if r.get("energy_kw") is not None else None
                ),
                "created_at": r["created_at"],
            }
        )
    return out


def descendants_map(zones: list[dict[str, Any]]) -> dict[str, set[str]]:
    """Map every zone id → the set of ids in its subtree (including itself).

    Rolling children into parents (a building's count includes its floors) is
    just a subtree membership test. Cycles cannot occur (parent_id references a
    zone and the UI builds a tree), but the walk guards against them anyway.
    """
    children: dict[Optional[str], list[str]] = {}
    for z in zones:
        children.setdefault(z["parent_id"], []).append(z["id"])

    result: dict[str, set[str]] = {}
    for z in zones:
        root = z["id"]
        seen: set[str] = set()
        stack = [root]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(children.get(cur, []))
        result[root] = seen
    return result


def subtree_ids(zone_id: str, zones: Optional[list[dict[str, Any]]] = None) -> set[str]:
    """Ids of ``zone_id`` and all its descendants (self only if it has no rows)."""
    zones = zones if zones is not None else all_zones()
    return descendants_map(zones).get(str(zone_id), {str(zone_id)})


# Everyone currently on site, tagged with their current zone. Single source of
# truth for /api/presence/now and the occupancy roll-up. "Current zone" = the
# zone of the door of the member's most recent granted event today.
_PEOPLE_ON_SITE_SQL = """
    SELECT a.member_id,
           m.full_name  AS member_name,
           m.department,
           m.member_type,
           a.first_in_ts,
           d.name       AS first_in_door_name,
           z.id         AS zone_id,
           z.name       AS zone_name
    FROM attendance_days a
    JOIN members m ON m.id = a.member_id AND m.status = 'active'
    LEFT JOIN doors d ON d.id = a.first_in_door
    LEFT JOIN LATERAL (
        SELECT e.door_id
        FROM access_events e
        WHERE e.member_id = a.member_id
          AND e.decision = 'granted'
          AND e.ts >= %s::date
        ORDER BY e.ts DESC
        LIMIT 1
    ) recent ON TRUE
    LEFT JOIN doors rd ON rd.id = recent.door_id
    LEFT JOIN zones z  ON z.id = rd.zone_id
    WHERE a.work_date = %s
      AND a.first_in_ts IS NOT NULL
      AND (a.last_out_ts IS NULL OR a.last_out_ts <= a.first_in_ts)
    ORDER BY a.first_in_ts ASC
"""


def people_on_site(today: dt.date) -> list[dict[str, Any]]:
    """On-site members (checked in today, not yet out), each with current zone."""
    rows = db.query_all(_PEOPLE_ON_SITE_SQL, (today, today))
    for r in rows:
        r["member_id"] = str(r["member_id"])
        r["zone_id"] = str(r["zone_id"]) if r.get("zone_id") else None
    return rows


def leaf_occupancy_counts(people: list[dict[str, Any]]) -> dict[str, int]:
    """Count on-site members per *leaf* current-zone (zone-less members ignored)."""
    counts: dict[str, int] = {}
    for p in people:
        zid = p.get("zone_id")
        if zid:
            counts[zid] = counts.get(zid, 0) + 1
    return counts


def leaf_congestion_counts() -> dict[str, int]:
    """Granted entries per zone (leaf) within the congestion window."""
    rows = db.query_all(
        """
        SELECT z.id AS zone_id, count(*) AS c
        FROM access_events e
        JOIN doors d ON d.id = e.door_id
        JOIN zones z ON z.id = d.zone_id
        WHERE e.decision = 'granted'
          AND e.ts > now() - (%s || ' minutes')::interval
        GROUP BY z.id
        """,
        (str(CONGESTION_WINDOW_MINUTES),),
    )
    return {str(r["zone_id"]): int(r["c"]) for r in rows}


def rollup_counts(
    zones: list[dict[str, Any]], leaf_counts: dict[str, int]
) -> dict[str, int]:
    """Roll leaf counts up the tree: each zone's total includes its subtree."""
    dmap = descendants_map(zones)
    totals: dict[str, int] = {}
    for z in zones:
        zid = z["id"]
        totals[zid] = sum(leaf_counts.get(cid, 0) for cid in dmap[zid])
    return totals
