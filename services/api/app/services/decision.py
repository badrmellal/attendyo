"""Recognition → access decision rules.

Implements section *"Recognition → decision rules"* of CONTRACT.md exactly:

1. Take the top engine match.
2. ``similarity < camera.recognition_threshold`` → ``unknown_face`` (door shut).
3. Member ``status != active`` → ``not_authorized``.
3b. (v2) Member has a validity window and today is outside
    ``[valid_from, valid_until]`` → ``not_authorized`` with reason
    ``"expired"`` / ``"not_yet_valid"``.
4. Member's access group does not include this door → ``not_authorized``.
5. Outside the access-group schedule → ``off_schedule``.
6. Otherwise → ``granted``.
7. Debounce: ignore the same member at the same door within
   ``attendance.min_revisit_seconds``.

All DB reads are synchronous; the recognize router runs ``decide`` in a thread.
The function is pure-ish: it only reads from the DB, never writes — the router
owns event/attendance writes so this stays testable and side-effect free.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any, Optional

from ..core import db

logger = logging.getLogger("liwan.decision")

# Weekday keys used in access_group.schedule JSON, Monday-first.
_WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


@dataclass(slots=True)
class Decision:
    """Resolved access decision for one recognition attempt."""

    decision: str  # granted | denied | unknown_face | not_authorized | off_schedule
    direction: str = "unknown"  # in | out | unknown
    reason: Optional[str] = None
    member: Optional[dict[str, Any]] = None
    similarity: Optional[float] = None
    subject_name: Optional[str] = None
    debounced: bool = False  # true => recognised, but suppressed as a repeat


def _resolve_direction(door: Optional[dict[str, Any]]) -> str:
    """Door-level direction hint. 'both' doors are resolved later (first/last)."""
    if not door:
        return "unknown"
    d = door.get("direction")
    if d in ("in", "out"):
        return d
    return "unknown"


def _within_schedule(schedule: dict[str, Any], now: dt.datetime) -> bool:
    """Return True if ``now`` falls inside the access-group schedule.

    ``schedule`` is ``{weekday: [start, end], ...}`` with ``HH:MM`` strings. An
    empty schedule means "any time". A weekday absent from the map means the
    group may not pass on that day.
    """
    if not schedule:
        return True

    key = _WEEKDAY_KEYS[now.weekday()]
    window = schedule.get(key)
    if not window:
        return False
    try:
        start_s, end_s = window[0], window[1]
        start_t = dt.datetime.strptime(start_s, "%H:%M").time()
        end_t = dt.datetime.strptime(end_s, "%H:%M").time()
    except (ValueError, IndexError, TypeError):
        logger.warning("Malformed schedule window for %s: %r", key, window)
        return True  # fail-open on bad config rather than locking everyone out

    now_t = now.timetz().replace(tzinfo=None)
    if start_t <= end_t:
        return start_t <= now_t <= end_t
    # Overnight window (e.g. 20:00–06:00).
    return now_t >= start_t or now_t <= end_t


def _door_allowed(access_group: Optional[dict[str, Any]], door_id: Optional[str]) -> bool:
    """Whether the access group permits this door.

    No group => unrestricted. Empty ``door_ids`` => all doors. Otherwise the door
    must be listed. A call with no door (e.g. kiosk without a bound door) is
    treated as allowed — there is no specific door to forbid.
    """
    if access_group is None:
        return True
    door_ids = access_group.get("door_ids") or []
    if not door_ids:
        return True
    if door_id is None:
        return True
    return str(door_id) in {str(d) for d in door_ids}


def _recently_seen(member_id: str, door_id: Optional[str], window_seconds: int) -> bool:
    """True if this member was granted at this door within ``window_seconds``."""
    if window_seconds <= 0:
        return False
    row = db.query_one(
        """
        SELECT 1
        FROM access_events
        WHERE member_id = %s
          AND decision = 'granted'
          AND (%s::uuid IS NULL OR door_id = %s::uuid)
          AND ts > now() - (%s || ' seconds')::interval
        ORDER BY ts DESC
        LIMIT 1
        """,
        (member_id, door_id, door_id, str(window_seconds)),
    )
    return row is not None


def decide(
    *,
    subject_name: Optional[str],
    similarity: Optional[float],
    face_detected: bool,
    door: Optional[dict[str, Any]],
    camera: Optional[dict[str, Any]],
    threshold: float,
    min_revisit_seconds: int,
    now: Optional[dt.datetime] = None,
) -> Decision:
    """Apply the contract decision rules and return a :class:`Decision`.

    ``door`` / ``camera`` are DB rows (dicts) or ``None``. ``threshold`` is the
    effective recognition threshold (camera value, falling back to a default).
    """
    now = now or dt.datetime.now(dt.timezone.utc)
    direction = _resolve_direction(door)
    door_id = str(door["id"]) if door else None

    # Rule 2 (and "no face"): nothing matched well enough.
    if not face_detected or not subject_name or similarity is None:
        return Decision(
            decision="unknown_face",
            direction=direction,
            reason="No face detected" if not face_detected else "No subject match",
            similarity=similarity,
            subject_name=subject_name,
        )
    if similarity < threshold:
        return Decision(
            decision="unknown_face",
            direction=direction,
            reason=f"Similarity {similarity:.2f} below threshold {threshold:.2f}",
            similarity=similarity,
            subject_name=subject_name,
        )

    # Resolve the member behind the matched subject.
    member = db.query_one(
        """
        SELECT id, external_id, full_name, subject_name, member_type, department,
               title, email, phone, access_group_id, valid_from, valid_until, status
        FROM members
        WHERE subject_name = %s
        LIMIT 1
        """,
        (subject_name,),
    )
    if member is None:
        # Engine knows the subject but Liwan has no member row for it.
        return Decision(
            decision="unknown_face",
            direction=direction,
            reason="Recognised subject has no member record",
            similarity=similarity,
            subject_name=subject_name,
        )

    # Rule 3: must be active.
    if member["status"] != "active":
        return Decision(
            decision="not_authorized",
            direction=direction,
            reason=f"Member status is {member['status']}",
            member=member,
            similarity=similarity,
            subject_name=subject_name,
        )

    # Rule 3b (v2): temporary-access validity window (visitors, contractors,
    # exchange students). NULL on either side = unbounded on that side.
    today = now.date()
    if member.get("valid_from") and today < member["valid_from"]:
        return Decision(
            decision="not_authorized",
            direction=direction,
            reason="not_yet_valid",
            member=member,
            similarity=similarity,
            subject_name=subject_name,
        )
    if member.get("valid_until") and today > member["valid_until"]:
        return Decision(
            decision="not_authorized",
            direction=direction,
            reason="expired",
            member=member,
            similarity=similarity,
            subject_name=subject_name,
        )

    # Load access group (if any) once for door + schedule checks.
    access_group = None
    if member.get("access_group_id"):
        access_group = db.query_one(
            "SELECT id, name, door_ids, schedule FROM access_groups WHERE id = %s",
            (member["access_group_id"],),
        )

    # Rule 4: door membership.
    if not _door_allowed(access_group, door_id):
        return Decision(
            decision="not_authorized",
            direction=direction,
            reason="Door not in member's access group",
            member=member,
            similarity=similarity,
            subject_name=subject_name,
        )

    # Rule 5: schedule window.
    if access_group is not None:
        schedule = access_group.get("schedule") or {}
        if not _within_schedule(schedule, now):
            return Decision(
                decision="off_schedule",
                direction=direction,
                reason="Outside permitted hours",
                member=member,
                similarity=similarity,
                subject_name=subject_name,
            )

    # Rule 7: debounce repeats at the same door.
    if _recently_seen(str(member["id"]), door_id, min_revisit_seconds):
        return Decision(
            decision="granted",
            direction=direction,
            reason="Debounced repeat (within min_revisit_seconds)",
            member=member,
            similarity=similarity,
            subject_name=subject_name,
            debounced=True,
        )

    # Rule 6: granted.
    return Decision(
        decision="granted",
        direction=direction,
        reason=None,
        member=member,
        similarity=similarity,
        subject_name=subject_name,
    )
