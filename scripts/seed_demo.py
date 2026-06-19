#!/usr/bin/env python3
"""Seed the LIWAN database with a realistic demo dataset.

Run this against a running Postgres (the one in docker-compose) to populate:

* 1 site (Siège Casablanca, 09:00–18:00, 10-min grace).
* 2 doors — a main entrance ("in") and a staff exit ("out").
* 1 camera bound to the entrance.
* ~18 members across departments (employees + a contractor + a visitor).
* A week of ``attendance_days`` with realistic morning-in / evening-out times,
  some late arrivals, and some absences.
* ~60 ``access_events`` for *today* (granted in/out + a few unknown/off-schedule)
  so the live monitor, stats and Gate have data.

It is **safe to re-run**: the demo set is cleared and rebuilt each time, while
operator users and settings are left untouched. The admin operator is ensured so
you can log in immediately.

Usage::

    # From the repo root, with the same env as the API (DB_HOST etc.):
    python scripts/seed_demo.py

    # Or inside the API container:
    docker compose exec liwan-api python -m scripts.seed_demo

Connection comes from the same environment variables the API uses
(``DB_HOST``/``DB_PORT``/``DB_NAME``/``DB_USER``/``DB_PASSWORD``). When run on the
host, point ``DB_HOST=localhost`` and ``DB_PORT=5432`` at the published port.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# Make the API package importable whether run as a script or a module, from the
# repo root or elsewhere. The API app dir holds the shared demo/db modules.
_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_DIR = _REPO_ROOT / "services" / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

logging.basicConfig(
    level=os.environ.get("LIWAN_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("liwan.seed_demo")


def main() -> int:
    # Imported after sys.path is set so the package resolves.
    from app.core import db  # noqa: E402
    from app.demo_data import seed_all  # noqa: E402
    from app.seed import ensure_admin_user  # noqa: E402

    logger.info("Connecting to database and seeding demo data…")
    db.init_pool()
    try:
        # Ensure the operator login exists so the demo is usable out of the box.
        ensure_admin_user()
        summary = seed_all()
    finally:
        db.close_pool()

    logger.info(
        "Done. site=%s doors=%d members=%d events_today=%d",
        summary["site"], len(summary["doors"]), summary["members"], summary["events_today"],
    )
    print(
        "Demo data seeded. Log in with the configured LIWAN_ADMIN_EMAIL / "
        "LIWAN_ADMIN_PASSWORD (default admin@liwan.local / liwan-admin)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
