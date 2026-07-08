"""Presence / muster router (v2, extended for v3 zones).

* ``GET /api/presence/now`` → everyone currently on site: members whose *today*
  attendance row has ``first_in_ts`` set and no later ``last_out_ts``.

Each person also carries their **current zone** (the zone of the door of their
most recent granted event today), and the endpoint accepts ``?zone_id=`` to
filter to a zone **including its descendants** — asking a building returns
everyone across its floors/areas ("show everyone currently inside Building B").

The Console renders this as the live on-site list and a print-ready evacuation
(muster) view — hence the door name of the first entry, so responders know
which entrance each person used.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..core import security
from ..models.schemas import PresenceNow, PresencePerson
from ..services import zones as zones_service

logger = logging.getLogger("attendyo.presence")

router = APIRouter(prefix="/api/presence", tags=["presence"])


def _compute_presence(zone_filter: Optional[str]) -> PresenceNow:
    today = zones_service.site_local_today()
    rows = zones_service.people_on_site(today)

    if zone_filter:
        zones = zones_service.all_zones()
        if not any(z["id"] == str(zone_filter) for z in zones):
            raise HTTPException(status_code=404, detail="Zone not found")
        subtree = zones_service.subtree_ids(zone_filter, zones)
        # Only people whose current zone is inside the requested subtree.
        rows = [r for r in rows if r.get("zone_id") and r["zone_id"] in subtree]

    people = [
        PresencePerson(
            member_id=r["member_id"],
            member_name=r["member_name"],
            department=r.get("department"),
            member_type=r["member_type"],
            first_in_ts=r["first_in_ts"],
            first_in_door_name=r.get("first_in_door_name"),
            zone_id=r.get("zone_id"),
            zone_name=r.get("zone_name"),
        )
        for r in rows
    ]
    return PresenceNow(count=len(people), people=people)


@router.get("/now", response_model=PresenceNow)
async def presence_now(
    zone_id: Optional[str] = Query(None, description="Filter to a zone + its descendants"),
    _user: dict = Depends(security.get_current_user),
) -> PresenceNow:
    """Live on-site list (checked in today, not yet checked out), optionally
    scoped to a zone and everything under it."""
    return await run_in_threadpool(_compute_presence, zone_id)
