"""In-process pub/sub broadcaster for Server-Sent Events.

Every recognition decision (``event: access``) and every security alert
(``event: alert``) is published here; the Console live monitor and the Gate
kiosk subscribe over ``GET /api/events/stream``. Each queue item is an
envelope ``{"event": <sse event type>, "data": <payload dict>}``.

This is intentionally a single-process, in-memory fan-out — appropriate for an
on-prem single-box deployment. Each subscriber gets its own bounded
``asyncio.Queue``; a slow/dead subscriber drops its oldest events instead of
back-pressuring the publisher.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger("liwan.events")

# Per-subscriber buffer. Recognition is bursty but low-volume; a small buffer is
# plenty and protects memory if a browser tab stalls.
_QUEUE_MAXSIZE = 100


class EventBus:
    """Async fan-out broadcaster of access events to SSE subscribers."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        """Register a new subscriber and return its private queue."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        async with self._lock:
            self._subscribers.add(queue)
        logger.debug("SSE subscriber added (now %d)", len(self._subscribers))
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove a subscriber's queue (on disconnect)."""
        async with self._lock:
            self._subscribers.discard(queue)
        logger.debug("SSE subscriber removed (now %d)", len(self._subscribers))

    async def publish(self, data: dict[str, Any], event_type: str = "access") -> None:
        """Broadcast ``data`` as an SSE event of ``event_type`` to all subscribers.

        ``event_type`` becomes the SSE ``event:`` field (``access`` for
        recognition decisions, ``alert`` for security alerts). Non-blocking: if
        a subscriber's buffer is full, its oldest event is dropped to make room
        — the live feed favours freshness over completeness.
        """
        envelope = {"event": event_type, "data": data}
        async with self._lock:
            targets = list(self._subscribers)
        for queue in targets:
            try:
                queue.put_nowait(envelope)
            except asyncio.QueueFull:
                try:
                    _ = queue.get_nowait()  # drop oldest
                    queue.put_nowait(envelope)
                except (asyncio.QueueEmpty, asyncio.QueueFull):  # pragma: no cover
                    pass

    @property
    def subscriber_count(self) -> int:
        """Current number of live subscribers (diagnostics)."""
        return len(self._subscribers)


# Module-level singleton shared by the publisher (recognize router) and the SSE
# endpoint (events router).
bus = EventBus()
