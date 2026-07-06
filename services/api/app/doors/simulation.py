"""Simulation door driver — the default.

No hardware. It logs the actuation and publishes a ``door_open`` event onto the
event bus so the Gate kiosk can animate the door-open pulse. Perfect for demos,
development, and sites without an electric lock yet.
"""

from __future__ import annotations

import logging
from typing import Any

from ..events_bus import bus
from .base import DoorActionResult, DoorContext, DoorDriver

logger = logging.getLogger("attendyo.doors.simulation")


class SimulationDriver(DoorDriver):
    """Logs + pushes a ``door_open`` event to the bus. Always reports opened."""

    name = "simulation"

    async def open(self, ctx: DoorContext) -> DoorActionResult:
        logger.info(
            "SIMULATION door open: door=%s member=%s direction=%s",
            self.door_name, ctx.member_name or ctx.member_id, ctx.direction,
        )
        await bus.publish(self._payload(ctx))
        return DoorActionResult(opened=True, detail="simulated open")

    def _payload(self, ctx: DoorContext) -> dict[str, Any]:
        return {
            "type": "door_open",
            "door_id": ctx.door_id,
            "door_name": ctx.door_name,
            "member_id": ctx.member_id,
            "member_name": ctx.member_name,
            "direction": ctx.direction,
            "relock_seconds": self.relock_seconds,
        }
