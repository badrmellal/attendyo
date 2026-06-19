"""Startup seeding: admin operator + optional demo dataset.

Called once on application startup. Two responsibilities:

* **Admin user** — ensure a login exists (``LIWAN_ADMIN_EMAIL`` /
  ``LIWAN_ADMIN_PASSWORD``) so the operator can sign in on first boot.
* **Demo data** — when ``LIWAN_DEMO_MODE`` is on and the DB is empty of members,
  populate a representative site, doors, members and attendance so the Console
  and Gate can be demoed immediately. This mirrors ``scripts/seed_demo.py`` but is
  safe to run unconditionally (it no-ops when data already exists).

Everything here is idempotent and synchronous; ``main`` invokes it via a thread.
"""

from __future__ import annotations

import logging

from .core import db, security
from .core.config import get_settings

logger = logging.getLogger("liwan.seed")


def ensure_admin_user() -> None:
    """Create the seeded admin operator if it does not already exist."""
    settings = get_settings()
    email = settings.liwan_admin_email
    existing = db.query_one("SELECT id FROM users WHERE lower(email) = lower(%s)", (email,))
    if existing:
        logger.info("Admin user %s already present", email)
        return
    pw_hash = security.hash_password(settings.liwan_admin_password)
    db.execute(
        "INSERT INTO users (email, password_hash, full_name, role) "
        "VALUES (%s, %s, %s, 'admin')",
        (email, pw_hash, "Administrator"),
    )
    logger.info("Seeded admin user %s", email)


def seed_demo_if_enabled() -> None:
    """Populate demo data when demo mode is on and no members exist yet."""
    settings = get_settings()
    if not settings.liwan_demo_mode:
        return
    member_count = (db.query_one("SELECT count(*) AS c FROM members") or {"c": 0})["c"]
    if member_count > 0:
        logger.info("Demo data already present (%s members); skipping seed", member_count)
        return

    logger.info("LIWAN_DEMO_MODE on and DB empty — seeding demo dataset")
    try:
        # Local import to avoid a hard dependency when the script is absent.
        from .demo_data import seed_all

        seed_all()
    except Exception as exc:  # pragma: no cover - demo only
        logger.warning("Demo seed failed (non-fatal): %s", exc)
