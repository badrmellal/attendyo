"""Zones router — the v3 spatial tree + live occupancy.

* ``GET/POST /api/zones``            → list (tree-flat, with parent_id) / create
* ``PATCH/DELETE /api/zones/{id}``   → mutate (operator+)
* ``GET /api/zones/occupancy``       → per-zone count + congestion (any authed user)

Zones are buildings / floors / areas linked by ``parent_id`` (see contract
``Zone``). Doors belong to a zone, so **camera → door → zone** is the location
chain: every recognition is a location fix at zone granularity. Reads are open
to any authenticated console user; mutations require operator+ and are audited
like every other entity.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..core import audit, db, security
from ..models.schemas import Zone, ZoneCreate, ZoneOccupancy, ZoneUpdate
from ..services import zones as zones_service

logger = logging.getLogger("attendyo.zones")

router = APIRouter(prefix="/api/zones", tags=["zones"])

_ZONE_COLUMNS = "id, name, kind, parent_id, capacity, energy_kw, created_at"


def _to_zone(row: dict[str, Any]) -> Zone:
    return Zone(
        id=str(row["id"]),
        name=row["name"],
        kind=row["kind"],
        parent_id=str(row["parent_id"]) if row.get("parent_id") else None,
        capacity=row.get("capacity"),
        energy_kw=float(row["energy_kw"]) if row.get("energy_kw") is not None else None,
        created_at=row["created_at"],
    )


# --------------------------------------------------------------------------- #
# Occupancy (declared before the ``/{zone_id}`` routes so the literal path wins)
# --------------------------------------------------------------------------- #
def _compute_occupancy() -> list[ZoneOccupancy]:
    zones = zones_service.all_zones()
    if not zones:
        return []
    today = zones_service.site_local_today()
    people = zones_service.people_on_site(today)
    leaf_counts = zones_service.leaf_occupancy_counts(people)
    totals = zones_service.rollup_counts(zones, leaf_counts)
    leaf_congestion = zones_service.leaf_congestion_counts()
    congestion_totals = zones_service.rollup_counts(zones, leaf_congestion)
    return [
        ZoneOccupancy(
            zone_id=z["id"],
            name=z["name"],
            kind=z["kind"],
            parent_id=z["parent_id"],
            count=totals.get(z["id"], 0),
            capacity=z.get("capacity"),
            congestion=congestion_totals.get(z["id"], 0),
        )
        for z in zones
    ]


@router.get("/occupancy", response_model=list[ZoneOccupancy])
async def zones_occupancy(
    _user: dict = Depends(security.get_current_user),
) -> list[ZoneOccupancy]:
    """Per-zone live occupancy and 15-minute congestion (children roll up)."""
    return await run_in_threadpool(_compute_occupancy)


# --------------------------------------------------------------------------- #
# CRUD
# --------------------------------------------------------------------------- #
@router.get("", response_model=list[Zone])
async def list_zones(_user: dict = Depends(security.get_current_user)) -> list[Zone]:
    rows = await run_in_threadpool(
        db.query_all, f"SELECT {_ZONE_COLUMNS} FROM zones ORDER BY kind, name ASC"
    )
    return [_to_zone(r) for r in rows]


@router.post("", response_model=Zone, status_code=status.HTTP_201_CREATED)
async def create_zone(
    payload: ZoneCreate,
    user: dict = Depends(security.require_operator),
) -> Zone:
    if payload.parent_id:
        parent = await run_in_threadpool(
            db.query_one, "SELECT id FROM zones WHERE id = %s", (payload.parent_id,)
        )
        if parent is None:
            raise HTTPException(status_code=422, detail="parent_id does not exist")
    row = await run_in_threadpool(
        db.execute_returning,
        f"""
        INSERT INTO zones (name, kind, parent_id, capacity, energy_kw)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING {_ZONE_COLUMNS}
        """,
        (
            payload.name, payload.kind, payload.parent_id,
            payload.capacity, payload.energy_kw,
        ),
    )
    assert row is not None
    await run_in_threadpool(
        audit.record, user, "zone.create", entity="zone", entity_id=str(row["id"]),
        details={"name": payload.name, "kind": payload.kind},
    )
    return _to_zone(row)


@router.patch("/{zone_id}", response_model=Zone)
async def update_zone(
    zone_id: str,
    payload: ZoneUpdate,
    user: dict = Depends(security.require_operator),
) -> Zone:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        row = await run_in_threadpool(
            db.query_one, f"SELECT {_ZONE_COLUMNS} FROM zones WHERE id = %s", (zone_id,)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Zone not found")
        return _to_zone(row)

    # Guard against a zone becoming its own parent (a trivial cycle).
    if updates.get("parent_id") is not None and str(updates["parent_id"]) == str(zone_id):
        raise HTTPException(status_code=422, detail="A zone cannot be its own parent")

    set_parts = [f"{col} = %s" for col in updates]
    params: list[Any] = list(updates.values())
    params.append(zone_id)
    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE zones SET {', '.join(set_parts)} WHERE id = %s RETURNING {_ZONE_COLUMNS}",
        params,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    await run_in_threadpool(
        audit.record, user, "zone.update", entity="zone", entity_id=zone_id,
        details={"fields": sorted(updates.keys())},
    )
    return _to_zone(row)


@router.delete("/{zone_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_zone(
    zone_id: str,
    user: dict = Depends(security.require_operator),
) -> None:
    # doors.zone_id and child zones are ON DELETE SET NULL; energy_rules cascade.
    affected = await run_in_threadpool(
        db.execute, "DELETE FROM zones WHERE id = %s", (zone_id,)
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Zone not found")
    await run_in_threadpool(
        audit.record, user, "zone.delete", entity="zone", entity_id=zone_id,
    )
    return None
