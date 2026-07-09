"""Settings / branding router.

* ``GET /api/settings`` → ``{ branding, attendance, security }`` (operator JWT
  or device key).
* ``PUT /api/settings`` → update any section (**admin only**).

Branding powers the white-label: Console and Gate read ``product_name``,
``primary_color``, ``locale`` … from here and never hard-code "Attendyo". Defaults
come from ``brand/BRAND.md`` and are seeded by ``db/schema.sql``.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from ..core import audit, db, security
from ..models.schemas import (
    AttendanceSettings,
    Branding,
    SecuritySettings,
    SiteSettings,
    SettingsOut,
    SettingsUpdate,
)

logger = logging.getLogger("attendyo.settings")

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Defaults mirror brand/BRAND.md and the schema seed, used if a key is missing.
_DEFAULT_BRANDING = Branding(
    product_name="Attendyo",
    tagline="The face is the key.",
    primary_color="#5663F2",
    accent_color="#E0A340",
    logo_url=None,
    locale="fr",
)
_DEFAULT_ATTENDANCE = AttendanceSettings(
    in_out_strategy="first_in_last_out",
    min_revisit_seconds=60,
    auto_open_on_grant=True,
)
_DEFAULT_SECURITY = SecuritySettings(alert_cooldown_seconds=45)


def _get_setting(key: str) -> dict[str, Any] | None:
    row = db.query_one("SELECT value FROM settings WHERE key = %s", (key,))
    return row["value"] if row else None


def load_branding() -> Branding:
    """Resolve branding, falling back to defaults for any missing field."""
    raw = _get_setting("branding") or {}
    return _DEFAULT_BRANDING.model_copy(update={k: v for k, v in raw.items() if v is not None})


def load_attendance() -> AttendanceSettings:
    """Resolve attendance config, falling back to defaults."""
    raw = _get_setting("attendance") or {}
    return _DEFAULT_ATTENDANCE.model_copy(
        update={k: v for k, v in raw.items() if v is not None}
    )


def load_security() -> SecuritySettings:
    """Resolve security config (alert cooldown …), falling back to defaults."""
    raw = _get_setting("security") or {}
    return _DEFAULT_SECURITY.model_copy(
        update={k: v for k, v in raw.items() if v is not None}
    )


def load_site() -> SiteSettings:
    """Working-day config from the single site row (drives late/overtime math)."""
    row = db.query_one(
        "SELECT timezone, workday_start, workday_end, grace_minutes "
        "FROM sites ORDER BY created_at LIMIT 1"
    )
    if not row:
        return SiteSettings()
    return SiteSettings(
        timezone=row["timezone"],
        # times come back as datetime.time — serialize to HH:MM for the wire.
        workday_start=row["workday_start"].strftime("%H:%M") if row.get("workday_start") else "09:00",
        workday_end=row["workday_end"].strftime("%H:%M") if row.get("workday_end") else "18:00",
        grace_minutes=int(row["grace_minutes"]),
    )


def _read_settings() -> SettingsOut:
    return SettingsOut(
        branding=load_branding(),
        attendance=load_attendance(),
        security=load_security(),
        site=load_site(),
    )


def _write_settings(update: SettingsUpdate) -> SettingsOut:
    if update.branding is not None:
        db.execute(
            "INSERT INTO settings (key, value) VALUES ('branding', %s::jsonb) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps(update.branding.model_dump()),),
        )
    if update.attendance is not None:
        db.execute(
            "INSERT INTO settings (key, value) VALUES ('attendance', %s::jsonb) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps(update.attendance.model_dump()),),
        )
    if update.security is not None:
        db.execute(
            "INSERT INTO settings (key, value) VALUES ('security', %s::jsonb) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (json.dumps(update.security.model_dump()),),
        )
    if update.site is not None:
        s = update.site
        # Update the single site row (create-then-set is out of scope; a site
        # always exists after seeding). Times validated by the SiteSettings schema.
        db.execute(
            "UPDATE sites SET timezone = %s, workday_start = %s, workday_end = %s, "
            "grace_minutes = %s "
            "WHERE id = (SELECT id FROM sites ORDER BY created_at LIMIT 1)",
            (s.timezone, s.workday_start, s.workday_end, max(0, s.grace_minutes)),
        )
    return _read_settings()


@router.get("", response_model=SettingsOut)
async def get_settings_endpoint(
    _auth: None = Depends(security.allow_operator_or_device),
) -> SettingsOut:
    # Readable by an operator JWT or a device key, so the Gate kiosk can theme
    # itself from the customer's white-label branding.
    return await run_in_threadpool(_read_settings)


@router.put("", response_model=SettingsOut)
async def put_settings_endpoint(
    payload: SettingsUpdate,
    admin: dict = Depends(security.require_admin),
) -> SettingsOut:
    """Update settings. Admin-only. Omitted sections are left unchanged."""
    result = await run_in_threadpool(_write_settings, payload)
    sections = [
        s for s, v in (
            ("branding", payload.branding),
            ("attendance", payload.attendance),
            ("security", payload.security),
        )
        if v is not None
    ]
    await run_in_threadpool(
        audit.record, admin, "settings.update", entity="settings",
        details={"sections": sections},
    )
    return result
