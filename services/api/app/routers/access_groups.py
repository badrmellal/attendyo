"""Access groups router — CRUD.

* ``GET/POST /api/access-groups``
* ``PATCH/DELETE /api/access-groups/{id}``

An access group decides which doors a member may open, and (optionally) the time
windows in which they may do so. ``door_ids`` empty => all doors; ``schedule`` ``{}``
=> any time. Members reference a group via ``Member.access_group_id``.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..core import audit, db, security
from ..models.schemas import AccessGroup, AccessGroupCreate, AccessGroupUpdate

logger = logging.getLogger("liwan.access_groups.router")

router = APIRouter(prefix="/api/access-groups", tags=["access-groups"])

_COLUMNS = "id, name, door_ids, schedule, created_at"


def _to_group(row: dict[str, Any]) -> AccessGroup:
    return AccessGroup(
        id=str(row["id"]),
        name=row["name"],
        door_ids=[str(d) for d in (row.get("door_ids") or [])],
        schedule=row.get("schedule") or {},
        created_at=row["created_at"],
    )


@router.get("", response_model=list[AccessGroup])
async def list_access_groups(
    _user: dict = Depends(security.get_current_user),
) -> list[AccessGroup]:
    rows = await run_in_threadpool(
        db.query_all, f"SELECT {_COLUMNS} FROM access_groups ORDER BY name ASC"
    )
    return [_to_group(r) for r in rows]


@router.post("", response_model=AccessGroup, status_code=status.HTTP_201_CREATED)
async def create_access_group(
    payload: AccessGroupCreate,
    user: dict = Depends(security.require_operator),
) -> AccessGroup:
    row = await run_in_threadpool(
        db.execute_returning,
        f"""
        INSERT INTO access_groups (name, door_ids, schedule)
        VALUES (%s, %s::uuid[], %s::jsonb)
        RETURNING {_COLUMNS}
        """,
        (payload.name, payload.door_ids, json.dumps(payload.schedule)),
    )
    assert row is not None
    await run_in_threadpool(
        audit.record, user, "access_group.create", entity="access_group",
        entity_id=str(row["id"]), details={"name": payload.name},
    )
    return _to_group(row)


@router.patch("/{group_id}", response_model=AccessGroup)
async def update_access_group(
    group_id: str,
    payload: AccessGroupUpdate,
    user: dict = Depends(security.require_operator),
) -> AccessGroup:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        row = await run_in_threadpool(
            db.query_one, f"SELECT {_COLUMNS} FROM access_groups WHERE id = %s", (group_id,)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Access group not found")
        return _to_group(row)

    # Cast array / json columns explicitly so psycopg2 coerces the values.
    casts = {"door_ids": "::uuid[]", "schedule": "::jsonb"}
    set_parts: list[str] = []
    params: list[Any] = []
    for col, val in updates.items():
        set_parts.append(f"{col} = %s{casts.get(col, '')}")
        params.append(json.dumps(val) if col == "schedule" else val)
    params.append(group_id)

    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE access_groups SET {', '.join(set_parts)} WHERE id = %s RETURNING {_COLUMNS}",
        params,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Access group not found")
    await run_in_threadpool(
        audit.record, user, "access_group.update", entity="access_group",
        entity_id=group_id, details={"fields": sorted(updates.keys())},
    )
    return _to_group(row)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_access_group(
    group_id: str,
    user: dict = Depends(security.require_operator),
) -> None:
    affected = await run_in_threadpool(
        db.execute, "DELETE FROM access_groups WHERE id = %s", (group_id,)
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Access group not found")
    await run_in_threadpool(
        audit.record, user, "access_group.delete", entity="access_group",
        entity_id=group_id,
    )
    return None
