"""Webhook door driver.

POSTs (or any configured method) a JSON payload to an external relay/controller
URL. Payloads are configurable templates so the same driver fits many
controllers (Shelly, ESPHome, a custom relay box, a building-management API).

``driver_config`` shape (from ``doors.driver_config`` JSONB)::

    {
      "url": "http://relay.lan/door/1",      # required
      "method": "POST",                       # default POST
      "headers": {"Authorization": "Bearer …"},
      "on_grant": {"action": "open", "ms": "{relock_ms}", "who": "{member_name}"},
      "on_deny":  {"action": "deny",  "who": "{member_name}"}
    }

Template tokens available in ``on_grant`` / ``on_deny`` string values:
``{door_id} {door_name} {member_id} {member_name} {direction} {decision}
{similarity} {relock_seconds} {relock_ms}``.

Stays on-prem: the URL points at a device on the LAN. Failures degrade to a
``DoorActionResult(opened=False)`` and are logged — they never crash a request.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .base import DoorActionResult, DoorContext, DoorDriver

logger = logging.getLogger("attendyo.doors.webhook")

# Default templates when the door config omits them.
_DEFAULT_ON_GRANT = {"action": "open", "relock_seconds": "{relock_seconds}"}
_DEFAULT_ON_DENY = {"action": "deny"}


class WebhookDriver(DoorDriver):
    """Fire a templated JSON request at an external door controller."""

    name = "webhook"

    async def open(self, ctx: DoorContext) -> DoorActionResult:
        template = self.config.get("on_grant", _DEFAULT_ON_GRANT)
        ok = await self._fire(template, ctx)
        return DoorActionResult(opened=ok, detail="webhook grant" if ok else "webhook failed")

    async def deny(self, ctx: DoorContext) -> DoorActionResult:
        template = self.config.get("on_deny")
        if template is None:
            return DoorActionResult(opened=False, detail="no on_deny configured")
        await self._fire(template, ctx)
        return DoorActionResult(opened=False, detail="webhook deny")

    # ------------------------------------------------------------------ #
    async def _fire(self, payload_template: Any, ctx: DoorContext) -> bool:
        url = self.config.get("url")
        if not url:
            logger.warning("Webhook door %s has no url configured", self.door_name)
            return False

        method = str(self.config.get("method", "POST")).upper()
        headers = {"Content-Type": "application/json"}
        headers.update(self.config.get("headers") or {})
        body = self._render(payload_template, ctx)

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.request(method, url, json=body, headers=headers)
        except httpx.HTTPError as exc:
            logger.warning("Webhook door %s unreachable: %s", self.door_name, exc)
            return False

        if resp.status_code >= 400:
            logger.warning(
                "Webhook door %s returned %s: %s",
                self.door_name, resp.status_code, resp.text[:200],
            )
            return False
        return True

    def _render(self, template: Any, ctx: DoorContext) -> Any:
        """Recursively substitute ``{token}`` placeholders in string leaves."""
        tokens = {
            "door_id": ctx.door_id,
            "door_name": ctx.door_name,
            "member_id": ctx.member_id or "",
            "member_name": ctx.member_name or "",
            "direction": ctx.direction,
            "decision": ctx.decision,
            "similarity": "" if ctx.similarity is None else f"{ctx.similarity:.4f}",
            "relock_seconds": self.relock_seconds,
            "relock_ms": self.relock_seconds * 1000,
        }

        def _sub(value: Any) -> Any:
            if isinstance(value, str):
                try:
                    return value.format(**tokens)
                except (KeyError, IndexError, ValueError):
                    return value
            if isinstance(value, dict):
                return {k: _sub(v) for k, v in value.items()}
            if isinstance(value, list):
                return [_sub(v) for v in value]
            return value

        return _sub(template)
