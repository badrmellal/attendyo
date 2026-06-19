"""Door-driver factory.

Builds the right :class:`DoorDriver` from a ``doors`` row (a dict as returned by
the DB layer). Unknown drivers fall back to ``simulation`` so a misconfigured
door never crashes the recognition hot path.
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from .base import DoorDriver
from .pi_gpio import PiGpioDriver
from .simulation import SimulationDriver
from .webhook import WebhookDriver

logger = logging.getLogger("liwan.doors.factory")

_REGISTRY: dict[str, type[DoorDriver]] = {
    "simulation": SimulationDriver,
    "webhook": WebhookDriver,
    "pi_gpio": PiGpioDriver,
}


def build(door: Mapping[str, Any]) -> DoorDriver:
    """Construct a driver instance for the given door row.

    ``door`` must contain ``id``, ``name``, ``driver``, ``driver_config`` and
    ``relock_seconds`` (exactly the columns of ``liwan.doors``).
    """
    driver_name = str(door.get("driver") or "simulation")
    cls = _REGISTRY.get(driver_name)
    if cls is None:
        logger.warning(
            "Unknown door driver %r for door %s; falling back to simulation",
            driver_name, door.get("name"),
        )
        cls = SimulationDriver

    config = door.get("driver_config") or {}
    if not isinstance(config, dict):
        config = {}

    return cls(
        door_id=str(door["id"]),
        door_name=str(door.get("name", "")),
        config=config,
        relock_seconds=int(door.get("relock_seconds") or 5),
    )
