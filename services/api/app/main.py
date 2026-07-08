"""ATTENDYO API — application factory and lifecycle.

Wires up the FastAPI app: CORS for the Console (:3000) and Gate (:3001), all
routers from the contract, a ``/media`` static mount, and startup work:

1. Initialise the Postgres connection pool.
2. Apply ``schema.sql`` if reachable on disk (self-healing when the DB init
   script did not run), then every ``db/migrations/*.sql`` in filename order —
   all migration files are idempotent, so this is safe on every boot.
3. Ensure the seeded admin operator exists.
4. Seed the demo dataset when ``ATTENDYO_DEMO_MODE`` is on and the DB is empty.

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
    alerts,
    ask,
    attendance,
    audit as audit_router,
    auth,
    cameras,
    doors,
    energy,
    events,
    health,
    insights,
    members,
    presence,
    recognize,
    reports,
    settings as settings_router,
    stats,
    users,
    zones,
)
from .seed import ensure_admin_user, seed_demo_if_enabled
from .services import energy as energy_service

logging.basicConfig(
    level=os.environ.get("ATTENDYO_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("attendyo.main")


def _run_sql_file(path: Path, label: str) -> None:
    """Execute one SQL file, logging success/failure (never raises)."""
    try:
        sql = path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not read %s %s (continuing): %s", label, path, exc)
        return
    try:
        with db.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
        logger.info("Applied %s %s", label, path.name)
    except Exception as exc:  # pragma: no cover - depends on live DB
        # Schema/migrations are normally applied by the Postgres init script; a
        # failure here is logged but not fatal so the API can still serve /health.
        logger.warning("Could not apply %s %s (continuing): %s", label, path.name, exc)


def _apply_schema_and_migrations() -> None:
    """Best-effort DB bootstrap: schema.sql, then db/migrations/*.sql in order.

    Every file is idempotent (``IF NOT EXISTS`` / conditional DO-blocks), so the
    whole sequence is safe to run on every startup — self-healing whether the
    database is fresh, at v1, or already at the latest version.
    """
    settings = get_settings()
    schema_path = Path(settings.schema_sql_path)
    if schema_path.exists():
        _run_sql_file(schema_path, "schema")
    else:
        logger.info(
            "schema.sql not found at %s; assuming DB initialised externally",
            schema_path,
        )

    migrations_dir = Path(settings.migrations_dir)
    if not migrations_dir.is_dir():
        logger.info("No migrations directory at %s; skipping", migrations_dir)
        return
    migration_files = sorted(migrations_dir.glob("*.sql"))
    if not migration_files:
        logger.info("Migrations directory %s is empty", migrations_dir)
        return
    for path in migration_files:
        _run_sql_file(path, "migration")


def _startup_sync() -> None:
    """Blocking startup steps, run once in a worker thread."""
    db.init_pool()
    media.ensure_dirs()
    _apply_schema_and_migrations()
    try:
        ensure_admin_user()
        seed_demo_if_enabled()
    except Exception as exc:  # pragma: no cover - depends on live DB
        logger.warning("Seeding skipped due to error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup seeding then tear the pool down on shutdown."""
    logger.info("ATTENDYO API %s starting up", __version__)
    try:
        await run_in_threadpool(_startup_sync)
    except Exception as exc:  # pragma: no cover
        # Never block startup on DB availability; /health reports the truth and
        # the orchestrator restarts dependencies. The pool retries on demand.
        logger.warning("Startup tasks deferred: %s", exc)
    # v3: occupancy-driven energy evaluator (~60s tick). Guarded so it no-ops
    # cleanly while the DB is briefly unavailable; never blocks startup.
    try:
        await energy_service.start_evaluator()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Energy evaluator not started: %s", exc)
    yield
    logger.info("ATTENDYO API shutting down")
    await energy_service.stop_evaluator()
    await run_in_threadpool(db.close_pool)


def create_app() -> FastAPI:
    """Construct and configure the FastAPI application."""
    settings = get_settings()
    app = FastAPI(
        title="ATTENDYO API",
        version=__version__,
        description="On-prem face attendance & access control. Implements attendyo/CONTRACT.md.",
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
    # v2 routers.
    app.include_router(reports.router)
    app.include_router(presence.router)
    app.include_router(alerts.router)
    app.include_router(audit_router.router)
    app.include_router(users.router)
    # v2.1 (Smart Gate).
    app.include_router(insights.router)
    # v3 (Spatial Intelligence).
    app.include_router(zones.router)
    app.include_router(ask.router)
    app.include_router(energy.router)

    # Static media (snapshots). Created at startup; mounting a missing dir would
    # raise, so ensure it exists here too for safety.
    media_dir = Path(settings.media_root)
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="media")

    @app.get("/", include_in_schema=False)
    async def root() -> JSONResponse:
        return JSONResponse(
            {
                "service": "attendyo-api",
                "version": __version__,
                "docs": "/docs",
                "health": "/health",
            }
        )

    return app


# Uvicorn entrypoint: ``uvicorn app.main:app``.
app = create_app()
