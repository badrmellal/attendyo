"""Settings / branding router.

* ``GET /api/settings`` → ``{ branding, attendance }`` (any authenticated user).
* ``PUT /api/settings`` → update branding and/or attendance (**admin only**).

Branding powers the white-label: Console and Gate read ``product_name``,
``primary_color``, ``locale`` … from here and never hard-code "Liwan". Defaults
come from ``brand/BRAND.md`` and are seeded by ``db/schema.sql``.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import (
    AttendanceSettings,
    Branding,
    SettingsOut,
    SettingsUpdate,
)

logger = logging.getLogger("liwan.settings")

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Defaults mirror brand/BRAND.md and the schema seed, used if a key is missing.
_DEFAULT_BRANDING = Branding(
    product_name="Liwan",
    tagline="The threshold that knows your people.",
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


def _read_settings() -> SettingsOut:
    return SettingsOut(branding=load_branding(), attendance=load_attendance())


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
    _admin: dict = Depends(security.require_admin),
) -> SettingsOut:
    """Update settings. Admin-only. Omitted sections are left unchanged."""
    return await run_in_threadpool(_write_settings, payload)
