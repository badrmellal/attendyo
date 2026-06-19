"""LIWAN API — application factory and lifecycle.

Wires up the FastAPI app: CORS for the Console (:3000) and Gate (:3001), all
routers from the contract, a ``/media`` static mount, and startup work:

1. Initialise the Postgres connection pool.
2. Apply ``schema.sql`` if reachable on disk (self-healing when the DB init
   script did not run).
3. Ensure the seeded admin operator exists.
4. Seed the demo dataset when ``LIWAN_DEMO_MODE`` is on and the DB is empty.

Everything is on-prem and offline: no telemetry, no outbound cloud calls.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__
from .core import db, media
from .core.config import get_settings
from .routers import (
    access_groups,
    attendance,
    auth,
    cameras,
    doors,
    events,
    health,
    members,
    recognize,
    settings as settings_router,
    stats,
)
from .seed import ensure_admin_user, seed_demo_if_enabled

logging.basicConfig(
    level=os.environ.get("LIWAN_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("liwan.main")


def _apply_schema() -> None:
    """Apply schema.sql if present on disk (idempotent CREATE IF NOT EXISTS)."""
    settings = get_settings()
    schema_path = Path(settings.schema_sql_path)
    if not schema_path.exists():
        logger.info(
            "schema.sql not found at %s; assuming DB initialised externally",
            schema_path,
        )
        return
    sql = schema_path.read_text(encoding="utf-8")
    try:
        with db.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
        logger.info("Applied schema.sql from %s", schema_path)
    except Exception as exc:  # pragma: no cover - depends on live DB
        # Schema is normally applied by the Postgres init script; a failure here
        # is logged but not fatal so the API can still serve /health.
        logger.warning("Could not apply schema.sql (continuing): %s", exc)


def _startup_sync() -> None:
    """Blocking startup steps, run once in a worker thread."""
    db.init_pool()
    media.ensure_dirs()
    _apply_schema()
    try:
        ensure_admin_user()
        seed_demo_if_enabled()
    except Exception as exc:  # pragma: no cover - depends on live DB
        logger.warning("Seeding skipped due to error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup seeding then tear the pool down on shutdown."""
    logger.info("LIWAN API %s starting up", __version__)
    try:
        await run_in_threadpool(_startup_sync)
    except Exception as exc:  # pragma: no cover
        # Never block startup on DB availability; /health reports the truth and
        # the orchestrator restarts dependencies. The pool retries on demand.
        logger.warning("Startup tasks deferred: %s", exc)
    yield
    logger.info("LIWAN API shutting down")
    await run_in_threadpool(db.close_pool)


def create_app() -> FastAPI:
    """Construct and configure the FastAPI application."""
    settings = get_settings()
    app = FastAPI(
        title="LIWAN API",
        version=__version__,
        description="On-prem face attendance & access control. Implements liwan/CONTRACT.md.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    # Routers (order is cosmetic; prefixes keep paths unambiguous).
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(members.router)
    app.include_router(recognize.router)
    app.include_router(attendance.router)
    app.include_router(events.router)
    app.include_router(stats.router)
    app.include_router(doors.router)
    app.include_router(cameras.router)
    app.include_router(access_groups.router)
    app.include_router(settings_router.router)

    # Static media (snapshots). Created at startup; mounting a missing dir would
    # raise, so ensure it exists here too for safety.
    media_dir = Path(settings.media_root)
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="media")

    @app.get("/", include_in_schema=False)
    async def root() -> JSONResponse:
        return JSONResponse(
            {
                "service": "liwan-api",
                "version": __version__,
                "docs": "/docs",
                "health": "/health",
            }
        )

    return app


# Uvicorn entrypoint: ``uvicorn app.main:app``.
app = create_app()
