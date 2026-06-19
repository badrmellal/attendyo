"""Door-driver abstraction.

A *door driver* turns an access decision into a physical (or simulated) action:
unlatch a relay, POST to a controller, or merely log + animate the Gate UI.

Drivers are constructed per-door from the ``doors`` row (see ``factory.build``)
and are cheap, stateless objects. ``open()`` and ``deny()`` are async so a driver
may perform I/O (HTTP, GPIO pulse with a relock delay) without blocking the loop.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class DoorContext:
    """Information passed to a driver for one actuation.

    Carried so webhook payload templates and audit logs can include who/where.
    """

    door_id: str
    door_name: str
    member_id: str | None = None
    member_name: str | None = None
    direction: str = "unknown"
    decision: str = "granted"
    similarity: float | None = None


@dataclass(slots=True)
class DoorActionResult:
    """Outcome of a driver action."""

    opened: bool
    detail: str = ""


class DoorDriver(abc.ABC):
    """Base class for all door drivers."""

    #: Stable identifier matching the ``doors.driver`` column.
    name: str = "base"

    def __init__(self, door_id: str, door_name: str, config: dict[str, Any],
                 relock_seconds: int = 5) -> None:
        self.door_id = door_id
        self.door_name = door_name
        self.config = config or {}
        self.relock_seconds = relock_seconds

    @abc.abstractmethod
    async def open(self, ctx: DoorContext) -> DoorActionResult:
        """Grant passage: actuate the door. Returns whether it physically opened."""
        raise NotImplementedError

    async def deny(self, ctx: DoorContext) -> DoorActionResult:
        """Signal a denial. Default is a no-op (door stays shut).

        Webhook/relay controllers may override to flash a red indicator.
        """
        return DoorActionResult(opened=False, detail="denied")
