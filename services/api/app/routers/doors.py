"""Doors router — CRUD + manual open.

* ``GET/POST /api/doors``
* ``PATCH/DELETE /api/doors/{id}``
* ``POST /api/doors/{id}/open`` → manually pulse the door (operator test button).

The manual-open endpoint actuates the configured driver and publishes a
``door_open`` event so the Gate UI animates even on a test pulse.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..core import audit, db, security
from ..doors import factory as door_factory
from ..doors.base import DoorContext
from ..models.schemas import Door, DoorCreate, DoorUpdate

logger = logging.getLogger("attendyo.doors.router")

router = APIRouter(prefix="/api/doors", tags=["doors"])

_DOOR_COLUMNS = (
    "id, site_id, name, location, direction, driver, driver_config, "
    "relock_seconds, enabled, zone_id, created_at"
)


def _to_door(row: dict[str, Any]) -> Door:
    cfg = row.get("driver_config")
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except ValueError:
            cfg = {}
    return Door(
        id=str(row["id"]),
        site_id=str(row["site_id"]) if row.get("site_id") else None,
        name=row["name"],
        location=row.get("location"),
        direction=row["direction"],
        driver=row["driver"],
        driver_config=cfg or {},
        relock_seconds=row["relock_seconds"],
        enabled=row["enabled"],
        zone_id=str(row["zone_id"]) if row.get("zone_id") else None,
        created_at=row["created_at"],
    )


@router.get("", response_model=list[Door])
async def list_doors(_user: dict = Depends(security.get_current_user)) -> list[Door]:
    rows = await run_in_threadpool(
        db.query_all, f"SELECT {_DOOR_COLUMNS} FROM doors ORDER BY created_at ASC"
    )
    return [_to_door(r) for r in rows]


@router.post("", response_model=Door, status_code=status.HTTP_201_CREATED)
async def create_door(
    payload: DoorCreate,
    user: dict = Depends(security.require_operator),
) -> Door:
    row = await run_in_threadpool(
        db.execute_returning,
        f"""
        INSERT INTO doors
            (site_id, name, location, direction, driver, driver_config,
             relock_seconds, enabled, zone_id)
        VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s)
        RETURNING {_DOOR_COLUMNS}
        """,
        (
            payload.site_id, payload.name, payload.location, payload.direction,
            payload.driver, json.dumps(payload.driver_config), payload.relock_seconds,
            payload.enabled, payload.zone_id,
        ),
    )
    assert row is not None
    await run_in_threadpool(
        audit.record, user, "door.create", entity="door", entity_id=str(row["id"]),
        details={"name": payload.name},
    )
    return _to_door(row)


@router.patch("/{door_id}", response_model=Door)
async def update_door(
    door_id: str,
    payload: DoorUpdate,
    user: dict = Depends(security.require_operator),
) -> Door:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        row = await run_in_threadpool(
            db.query_one, f"SELECT {_DOOR_COLUMNS} FROM doors WHERE id = %s", (door_id,)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Door not found")
        return _to_door(row)

    set_parts: list[str] = []
    params: list[Any] = []
    for col, val in updates.items():
        if col == "driver_config":
            set_parts.append("driver_config = %s::jsonb")
            params.append(json.dumps(val))
        else:
            set_parts.append(f"{col} = %s")
            params.append(val)
    params.append(door_id)
    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE doors SET {', '.join(set_parts)} WHERE id = %s RETURNING {_DOOR_COLUMNS}",
        params,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Door not found")
    await run_in_threadpool(
        audit.record, user, "door.update", entity="door", entity_id=door_id,
        details={"fields": sorted(updates.keys())},
    )
    return _to_door(row)


@router.delete("/{door_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_door(
    door_id: str,
    user: dict = Depends(security.require_operator),
) -> None:
    affected = await run_in_threadpool(
        db.execute, "DELETE FROM doors WHERE id = %s", (door_id,)
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Door not found")
    await run_in_threadpool(
        audit.record, user, "door.delete", entity="door", entity_id=door_id,
    )
    return None


@router.post("/{door_id}/open")
async def open_door(
    door_id: str,
    current_user: dict = Depends(security.require_operator),
) -> dict[str, Any]:
    """Manually pulse the door (operator test). Actuates the configured driver."""
    door = await run_in_threadpool(
        db.query_one, f"SELECT {_DOOR_COLUMNS} FROM doors WHERE id = %s", (door_id,)
    )
    if door is None:
        raise HTTPException(status_code=404, detail="Door not found")

    driver = door_factory.build(door)
    ctx = DoorContext(
        door_id=str(door["id"]),
        door_name=door.get("name", ""),
        member_id=None,
        member_name=current_user.get("full_name") or current_user.get("email"),
        direction="unknown",
        decision="granted",
    )
    try:
        result = await driver.open(ctx)
    except Exception as exc:  # pragma: no cover - driver-specific
        logger.warning("Manual door open failed: %s", exc)
        raise HTTPException(status_code=502, detail="Door driver failed") from exc

    await run_in_threadpool(
        audit.record, current_user, "door.open", entity="door", entity_id=door_id,
        details={"opened": result.opened, "manual": True},
    )
    return {"door_id": str(door["id"]), "opened": result.opened, "detail": result.detail}
