"""Health router — ``GET /health``.

Unauthenticated liveness/readiness probe used by Docker and the UIs. Reports DB
and CompreFace reachability. Overall ``status`` is ``ok`` only when the DB is up
(the engine being down is degraded, not fatal — demo mode and management UI still
work without it).
"""

from __future__ import annotations

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from ..core import compreface, db
from ..models.schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    db_ok = await run_in_threadpool(db.ping)
    cf_ok = await run_in_threadpool(compreface.health)
    return HealthOut(
        status="ok" if db_ok else "degraded",
        compreface="ok" if cf_ok else "down",
        db="ok" if db_ok else "down",
    )
