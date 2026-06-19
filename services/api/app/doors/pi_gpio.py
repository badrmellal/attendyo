"""Raspberry Pi GPIO door driver.

Best-effort relay pulse via ``gpiozero``. On a Pi wired to a relay/strike this
unlatches the door for ``relock_seconds`` then re-locks. Everywhere else
(``gpiozero`` not installed, no GPIO hardware) it degrades gracefully: it logs a
warning and reports ``opened=False`` rather than raising — so the same image runs
on a developer laptop and on the device.

``driver_config`` shape (from ``doors.driver_config`` JSONB)::

    {"pin": 17, "active_high": true, "host": null}

``host`` (optional) targets a *remote* Pi via ``gpiozero``'s pigpio pin factory
(``PiGPIOFactory``) so the relay can live on a different box than the API.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .base import DoorActionResult, DoorContext, DoorDriver

logger = logging.getLogger("liwan.doors.pi_gpio")


class PiGpioDriver(DoorDriver):
    """Pulse a GPIO-driven relay to unlatch a door, with graceful fallback."""

    name = "pi_gpio"

    async def open(self, ctx: DoorContext) -> DoorActionResult:
        pin = self.config.get("pin")
        if pin is None:
            logger.warning("pi_gpio door %s has no pin configured", self.door_name)
            return DoorActionResult(opened=False, detail="no pin configured")

        active_high = bool(self.config.get("active_high", True))
        host = self.config.get("host")

        # Run the (blocking, hardware) pulse off the event loop.
        ok = await asyncio.to_thread(self._pulse, int(pin), active_high, host)
        if ok:
            return DoorActionResult(opened=True, detail=f"gpio pulse pin {pin}")
        return DoorActionResult(opened=False, detail="gpio unavailable")

    def _pulse(self, pin: int, active_high: bool, host: Any) -> bool:
        """Blocking relay pulse. Returns False if hardware/lib is absent."""
        try:
            from gpiozero import OutputDevice  # type: ignore
        except Exception as exc:  # ImportError or platform error
            logger.warning(
                "gpiozero unavailable on this host (%s); door %s not actuated. "
                "Install on the Pi or use the 'webhook'/'simulation' driver.",
                exc, self.door_name,
            )
            return False

        relay = None
        try:
            kwargs: dict[str, Any] = {"active_high": active_high, "initial_value": False}
            if host:
                try:
                    from gpiozero.pins.pigpio import PiGPIOFactory  # type: ignore

                    kwargs["pin_factory"] = PiGPIOFactory(host=str(host))
                except Exception as exc:  # pragma: no cover - remote pin optional
                    logger.warning("Remote pigpio factory failed for %s: %s", host, exc)

            relay = OutputDevice(pin, **kwargs)
            relay.on()
            # Hold the strike for the relock window, then release.
            import time

            time.sleep(max(0, self.relock_seconds))
            relay.off()
            return True
        except Exception as exc:  # pragma: no cover - hardware-dependent
            logger.warning("GPIO pulse failed on door %s: %s", self.door_name, exc)
            return False
        finally:
            if relay is not None:
                try:
                    relay.close()
                except Exception:  # pragma: no cover
                    pass
