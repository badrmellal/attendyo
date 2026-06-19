"""Cameras router — CRUD.

* ``GET/POST /api/cameras``
* ``PATCH/DELETE /api/cameras/{id}``

A camera is a video source bound to a door, carrying its own recognition and
detection thresholds (used by the recognize hot path).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import Camera, CameraCreate, CameraUpdate

logger = logging.getLogger("liwan.cameras.router")

router = APIRouter(prefix="/api/cameras", tags=["cameras"])

_CAMERA_COLUMNS = (
    "id, door_id, name, source, recognition_threshold, det_prob_threshold, "
    "enabled, created_at"
)


def _to_camera(row: dict[str, Any]) -> Camera:
    return Camera(
        id=str(row["id"]),
        door_id=str(row["door_id"]) if row.get("door_id") else None,
        name=row["name"],
        source=row.get("source"),
        recognition_threshold=float(row["recognition_threshold"]),
        det_prob_threshold=float(row["det_prob_threshold"]),
        enabled=row["enabled"],
        created_at=row["created_at"],
    )


@router.get("", response_model=list[Camera])
async def list_cameras(_user: dict = Depends(security.get_current_user)) -> list[Camera]:
    rows = await run_in_threadpool(
        db.query_all, f"SELECT {_CAMERA_COLUMNS} FROM cameras ORDER BY created_at ASC"
    )
    return [_to_camera(r) for r in rows]


@router.post("", response_model=Camera, status_code=status.HTTP_201_CREATED)
async def create_camera(
    payload: CameraCreate,
    _user: dict = Depends(security.get_current_user),
) -> Camera:
    row = await run_in_threadpool(
        db.execute_returning,
        f"""
        INSERT INTO cameras
            (door_id, name, source, recognition_threshold, det_prob_threshold, enabled)
        VALUES (%s,%s,%s,%s,%s,%s)
        RETURNING {_CAMERA_COLUMNS}
        """,
        (
            payload.door_id, payload.name, payload.source,
            payload.recognition_threshold, payload.det_prob_threshold, payload.enabled,
        ),
    )
    assert row is not None
    return _to_camera(row)


@router.patch("/{camera_id}", response_model=Camera)
async def update_camera(
    camera_id: str,
    payload: CameraUpdate,
    _user: dict = Depends(security.get_current_user),
) -> Camera:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        row = await run_in_threadpool(
            db.query_one, f"SELECT {_CAMERA_COLUMNS} FROM cameras WHERE id = %s", (camera_id,)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Camera not found")
        return _to_camera(row)

    set_parts = [f"{col} = %s" for col in updates]
    params = list(updates.values())
    params.append(camera_id)
    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE cameras SET {', '.join(set_parts)} WHERE id = %s RETURNING {_CAMERA_COLUMNS}",
        params,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    return _to_camera(row)


@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(
    camera_id: str,
    _user: dict = Depends(security.get_current_user),
) -> None:
    affected = await run_in_threadpool(
        db.execute, "DELETE FROM cameras WHERE id = %s", (camera_id,)
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Camera not found")
    return None
