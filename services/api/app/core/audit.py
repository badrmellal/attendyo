"""Append-only audit trail.

Every operator action that mutates state is recorded in ``liwan.audit_log`` for
compliance (banks, government, universities). The API only ever INSERTs here —
nothing updates or deletes audit rows.

Usage from an async router::

    await run_in_threadpool(
        audit.record, user, "member.create", entity="member", entity_id=member_id,
        details={"full_name": full_name},
    )

``record`` is deliberately best-effort: an audit failure is logged but never
breaks the business operation (the DB may be briefly unavailable during
startup). Actions follow the contract vocabulary: ``login``,
``member.create|update|delete|import``, ``door.create|update|delete|open``,
``camera.create|update|delete``, ``access_group.create|update|delete``,
``settings.update``, ``user.create|update|delete``, ``alerts.ack``.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Mapping, Optional

from . import db

logger = logging.getLogger("liwan.audit")


def record(
    user: Optional[Mapping[str, Any]],
    action: str,
    *,
    entity: Optional[str] = None,
    entity_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Write one audit row (synchronous; call via ``run_in_threadpool``).

    ``user`` is the resolved operator dict from the JWT dependency (or ``None``
    for anonymous/system actions). ``entity_id`` is stored as text so UUIDs and
    numeric ids both fit. Never raises.
    """
    try:
        user_id = str(user["id"]) if user and user.get("id") else None
        user_email = user.get("email") if user else None
        db.execute(
            """
            INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, details)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                user_id,
                user_email,
                action,
                entity,
                str(entity_id) if entity_id is not None else None,
                json.dumps(details or {}, default=str),
            ),
        )
    except Exception as exc:  # pragma: no cover - defensive by design
        logger.warning("Audit write failed for action %s: %s", action, exc)
