"""Recognition router — ``POST /api/recognize`` (the hot path).

Device/kiosk endpoint, authenticated by ``X-Device-Key`` (not a JWT). For each
frame it:

1. (Demo mode) returns a random active member without touching the engine, or
2. Calls the vision engine's ``recognize`` on the uploaded image.
   **No face at all in the frame** (empty hallway, blur) → returns
   ``{decision:"no_face", door_opened:false, direction:"unknown"}`` and does
   NOTHING else — no event, no alert, no attendance, no door, no SSE
   (Smart Gate rules v2.1). ``no_face`` exists on the wire only.
3. Runs the contract decision rules (``services.decision``).
4. On ``granted``: infers the effective direction (door in/out wins; both/none
   → on-site ⇒ out else in), writes the event with it, feeds it to the
   attendance roll-up, claims the member's one-shot ``kiosk_message``, and
   fires the door driver. Exits also get a localized ``day_summary``.
5. On any non-granted decision, records an ``alerts`` row (per-(door, kind)
   cooldown). Granted double-entries at an explicitly-"in" door add a soft
   ``anti_passback`` info alert (door still opens).
6. Publishes the event (and any alert) onto the SSE bus (``event: access`` /
   ``event: alert``).
7. Returns a ``RecognizeResult`` with a localized, direction- and time-aware
   greeting.

Returns 200 for every analysed frame (the decision lives in the body); only
auth, bad input, and engine-outage produce error status codes. Demo mode flows
through the exact same greeting/direction/message code as the real engine path.
"""

from __future__ import annotations

import datetime as dt
import logging
import random
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from ..core import db, engine, media, security
from ..events_bus import bus
from ..doors import factory as door_factory
from ..doors.base import DoorContext
from ..models.schemas import RecognizeMember, RecognizeResult
from ..services import attendance as attendance_service
from ..services import decision as decision_service
from . import alerts as alerts_router
from . import settings as settings_router

logger = logging.getLogger("attendyo.recognize")

router = APIRouter(prefix="/api", tags=["recognition"])

_DEFAULT_THRESHOLD = 0.88
_MAX_IMAGE_BYTES = 12 * 1024 * 1024

# Localized greetings by locale (contract: fr/en/ar) — direction- and
# time-aware per the Smart Gate rules:
#   in  : before 12:00 site-local → morning, 18:00+ → evening, else day.
#   out : farewell (+ the kiosk shows the "Sortie" chip and a day summary).
_GREETINGS: dict[str, dict[str, str]] = {
    "fr": {
        "morning": "Bonjour {name}",
        "day": "Bienvenue {name}",
        "evening": "Bonsoir {name}",
        "out": "Au revoir {name}",
    },
    "en": {
        "morning": "Good morning {name}",
        "day": "Welcome {name}",
        "evening": "Good evening {name}",
        "out": "Goodbye {name}",
    },
    "ar": {
        "morning": "صباح الخير {name}",
        "day": "مرحبا {name}",
        "evening": "مساء الخير {name}",
        "out": "مع السلامة {name}",
    },
}

# Localized day summary on exits: total on-site time today ("Xh Ymin" kept
# simple; fr example from the contract: "8 h 12 sur site aujourd'hui").
# Stays under one hour use the minutes-only form ("25 min sur site aujourd'hui")
# so the kiosk never reads "0 h 25".
_DAY_SUMMARIES = {
    "fr": "{h} h {m:02d} sur site aujourd'hui",
    "en": "{h} h {m:02d} min on site today",
    "ar": "{h} س {m:02d} د في الموقع اليوم",
}
_DAY_SUMMARIES_UNDER_HOUR = {
    "fr": "{m} min sur site aujourd'hui",
    "en": "{m} min on site today",
    "ar": "{m} د في الموقع اليوم",
}


def _greeting(locale: str, name: str, direction: str, local_hour: int) -> str:
    """Build the localized, direction- and time-aware kiosk greeting."""
    table = _GREETINGS.get(locale, _GREETINGS["fr"])
    # {name} = first token of full_name for a warm, uncluttered kiosk line.
    first = name.split(" ")[0] if name else name
    if direction == "out":
        key = "out"
    elif local_hour < 12:
        key = "morning"
    elif local_hour >= 18:
        key = "evening"
    else:
        key = "day"
    return table[key].format(name=first)


def _day_summary(locale: str, worked_seconds: Optional[int]) -> Optional[str]:
    """Localized total on-site time for today, or None when not computable."""
    if worked_seconds is None or worked_seconds < 0:
        return None
    hours, minutes = divmod(int(worked_seconds) // 60, 60)
    if hours == 0:
        template = _DAY_SUMMARIES_UNDER_HOUR.get(locale, _DAY_SUMMARIES_UNDER_HOUR["fr"])
        return template.format(m=max(minutes, 1))
    template = _DAY_SUMMARIES.get(locale, _DAY_SUMMARIES["fr"])
    return template.format(h=hours, m=minutes)


def _load_door(door_id: Optional[str]) -> Optional[dict[str, Any]]:
    if not door_id:
        return None
    return db.query_one(
        "SELECT id, site_id, name, location, direction, driver, driver_config, "
        "relock_seconds, enabled FROM doors WHERE id = %s",
        (door_id,),
    )


def _load_camera(camera_id: Optional[str]) -> Optional[dict[str, Any]]:
    if not camera_id:
        return None
    return db.query_one(
        "SELECT id, door_id, name, source, recognition_threshold, det_prob_threshold, "
        "enabled FROM cameras WHERE id = %s",
        (camera_id,),
    )


def _write_event(
    *,
    decision: decision_service.Decision,
    door_id: Optional[str],
    camera_id: Optional[str],
    snapshot_path: Optional[str],
) -> dict[str, Any]:
    """Insert the access_event row and return it joined with member/door names."""
    member_id = str(decision.member["id"]) if decision.member else None
    row = db.execute_returning(
        """
        INSERT INTO access_events
            (member_id, subject_name, similarity, door_id, camera_id, direction,
             decision, reason, snapshot_path)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id, ts
        """,
        (
            member_id,
            decision.subject_name,
            decision.similarity,
            door_id,
            camera_id,
            decision.direction,
            decision.decision,
            decision.reason,
            snapshot_path,
        ),
    )
    assert row is not None
    return row


def _claim_kiosk_message(member_id: str) -> Optional[str]:
    """Atomically deliver-and-clear the member's one-shot door-side message.

    ``FOR UPDATE`` inside the CTE serialises two kiosks recognising the same
    member at once: the second claim re-reads the already-cleared row and
    returns nothing, so the note is delivered exactly once. Never raises —
    message delivery must not break the hot path.
    """
    try:
        row = db.execute_returning(
            """
            WITH claimed AS (
                SELECT id, kiosk_message
                FROM members
                WHERE id = %s AND kiosk_message IS NOT NULL
                FOR UPDATE
            )
            UPDATE members m
            SET kiosk_message = NULL, updated_at = now()
            FROM claimed
            WHERE m.id = claimed.id AND claimed.kiosk_message IS NOT NULL
            RETURNING claimed.kiosk_message AS message
            """,
            (member_id,),
        )
    except Exception as exc:  # pragma: no cover - hot path must not break
        logger.warning("Could not claim kiosk message for %s: %s", member_id, exc)
        return None
    return row["message"] if row else None


def _resolve_threshold(camera: Optional[dict[str, Any]]) -> float:
    if camera and camera.get("recognition_threshold") is not None:
        return float(camera["recognition_threshold"])
    return _DEFAULT_THRESHOLD


def _pick_demo_member() -> Optional[dict[str, Any]]:
    """Return a random active, currently-valid member for demo mode."""
    rows = db.query_all(
        """
        SELECT id, full_name, department, title, subject_name
        FROM members
        WHERE status = 'active'
          AND (valid_from  IS NULL OR valid_from  <= current_date)
          AND (valid_until IS NULL OR valid_until >= current_date)
        ORDER BY random() LIMIT 1
        """
    )
    return rows[0] if rows else None


def _build_event_payload(
    event_row: dict[str, Any],
    decision: decision_service.Decision,
    door: Optional[dict[str, Any]],
    snapshot_path: Optional[str],
) -> dict[str, Any]:
    """Shape an SSE ``AccessEvent`` payload (matches contract AccessEvent)."""
    member = decision.member or {}
    return {
        "id": event_row["id"],
        "ts": event_row["ts"].isoformat() if isinstance(event_row["ts"], dt.datetime) else event_row["ts"],
        "member_id": str(member["id"]) if member.get("id") else None,
        "member_name": member.get("full_name"),
        "subject_name": decision.subject_name,
        "similarity": decision.similarity,
        "door_id": str(door["id"]) if door else None,
        "door_name": door.get("name") if door else None,
        "direction": decision.direction,
        "decision": decision.decision,
        "reason": decision.reason,
        "snapshot_url": media.public_url(snapshot_path),
    }


@router.post("/recognize", response_model=RecognizeResult)
async def recognize(
    image: UploadFile = File(...),
    camera_id: Optional[str] = Form(None),
    door_id: Optional[str] = Form(None),
    _device: str = Depends(security.require_device_key),
) -> RecognizeResult:
    """Recognize a face and act on the decision. See module docstring."""
    data = await image.read()
    if not data:
        raise HTTPException(status_code=422, detail="Empty image")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 12 MB limit")

    from ..core.config import get_settings

    demo_mode = get_settings().attendyo_demo_mode

    # Load context (camera/door) and branding off-loop.
    def _load_context() -> tuple[Optional[dict], Optional[dict], Any]:
        camera = _load_camera(camera_id)
        # If no explicit door, fall back to the camera's bound door.
        effective_door_id = door_id or (camera.get("door_id") if camera else None)
        door = _load_door(str(effective_door_id) if effective_door_id else None)
        branding = settings_router.load_branding()
        return camera, door, branding

    camera, door, branding = await run_in_threadpool(_load_context)
    locale = branding.locale
    threshold = _resolve_threshold(camera)
    attendance_cfg = await run_in_threadpool(settings_router.load_attendance)
    now = dt.datetime.now(dt.timezone.utc)

    # ---- Recognition (demo short-circuit or real engine) ------------------- #
    if demo_mode:
        decision = await run_in_threadpool(_demo_decision, door, threshold)
        if decision is None:
            # No members enrolled yet — behave like an unknown face.
            decision = decision_service.Decision(
                decision="unknown_face", direction=_safe_direction(door),
                reason="No demo members available",
            )
    else:
        try:
            recognition = await run_in_threadpool(
                engine.recognize,
                data,
                filename=image.filename or "frame.jpg",
                det_prob_threshold=(
                    float(camera["det_prob_threshold"])
                    if camera and camera.get("det_prob_threshold") is not None
                    else None
                ),
            )
        except engine.EngineNoFace:
            # Nobody in frame — a silent non-event end to end (Smart Gate v2.1):
            # no event, no alert, no attendance, no door action, no SSE.
            return RecognizeResult(
                decision="no_face", door_opened=False, direction="unknown"
            )
        except engine.EngineUnavailable as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Recognition engine unavailable",
            ) from exc
        except engine.EngineRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        decision = await run_in_threadpool(
            decision_service.decide,
            subject_name=recognition.subject,
            similarity=recognition.similarity,
            face_detected=recognition.face_detected,
            door=door,
            camera=camera,
            threshold=threshold,
            min_revisit_seconds=attendance_cfg.min_revisit_seconds,
            now=now,
        )

    # ---- Effective direction + site-local context (grants only) ------------ #
    # Contract: door "in"/"out" wins; "both"/no door → on-site ⇒ out, else in.
    # The same context also powers the time-aware greeting and anti-passback.
    door_id_eff = str(door["id"]) if door else None
    camera_id_eff = str(camera["id"]) if camera else None
    grant_ctx: Optional[dict[str, Any]] = None
    was_on_site = False
    if decision.decision == "granted" and decision.member:
        grant_ctx = await run_in_threadpool(
            attendance_service.grant_context,
            str(decision.member["id"]),
            door_id_eff,
        )
        was_on_site = bool(grant_ctx["on_site"])
        door_dir = door.get("direction") if door else None
        if door_dir in ("in", "out"):
            decision.direction = door_dir
        else:
            decision.direction = "out" if was_on_site else "in"

    # ---- Persist snapshot (best-effort) ------------------------------------ #
    snapshot_path: Optional[str] = None
    try:
        snapshot_path = await run_in_threadpool(media.save_snapshot, data)
    except OSError as exc:  # pragma: no cover - disk issue
        logger.warning("Could not store snapshot: %s", exc)

    # ---- Write event ------------------------------------------------------- #
    event_row = await run_in_threadpool(
        _write_event,
        decision=decision,
        door_id=door_id_eff,
        camera_id=camera_id_eff,
        snapshot_path=snapshot_path,
    )

    door_opened = False
    day_summary: Optional[str] = None
    kiosk_message: Optional[str] = None

    # ---- On grant: attendance + message + door ------------------------------ #
    if decision.decision == "granted" and decision.member:
        member_id = str(decision.member["id"])
        attendance_row: Optional[dict[str, Any]] = None
        if not decision.debounced:
            # The roll-up consumes the INFERRED direction (an inferred "out"
            # sets last_out_ts).
            attendance_row = await run_in_threadpool(
                attendance_service.record_granted_event,
                member_id=member_id,
                event_ts=event_row["ts"],
                direction=decision.direction,
                door_id=door_id_eff,
            )
        elif decision.direction == "out" and grant_ctx is not None:
            # Debounced exit: read the existing row so the farewell still
            # carries today's summary.
            attendance_row = await run_in_threadpool(
                attendance_service.today_row, member_id, grant_ctx["work_date"]
            )

        # Day summary AFTER the roll-up, exits only (contract).
        if decision.direction == "out" and attendance_row is not None:
            day_summary = _day_summary(locale, attendance_row.get("worked_seconds"))

        # One-shot door-side message: deliver + clear atomically.
        kiosk_message = await run_in_threadpool(_claim_kiosk_message, member_id)

        # Fire the door driver if a door is bound and auto-open is on.
        if door and door.get("enabled", True) and attendance_cfg.auto_open_on_grant:
            driver = door_factory.build(door)
            ctx = DoorContext(
                door_id=str(door["id"]),
                door_name=door.get("name", ""),
                member_id=member_id,
                member_name=decision.member.get("full_name"),
                direction=decision.direction,
                decision="granted",
                similarity=decision.similarity,
            )
            try:
                result = await driver.open(ctx)
                door_opened = result.opened
            except Exception as exc:  # pragma: no cover - driver-specific
                logger.warning("Door driver failed on grant: %s", exc)

    # ---- Alerts -------------------------------------------------------------- #
    # Non-granted decisions alert as before; a granted double-entry at an
    # explicitly-"in" door adds a soft anti-passback info alert (door still
    # opened). Both respect the per-(door, kind) cooldown.
    alert_payload: Optional[dict[str, Any]] = None
    if decision.decision != "granted":
        alert_payload = await run_in_threadpool(
            alerts_router.record_decision_alert,
            decision=decision.decision,
            reason=decision.reason,
            event_id=event_row["id"],
            door_id=door_id_eff,
            door_name=door.get("name") if door else None,
            member_id=str(decision.member["id"]) if decision.member else None,
            member_name=decision.member.get("full_name") if decision.member else None,
        )
    elif (
        decision.member
        and not decision.debounced
        and was_on_site
        and door is not None
        and door.get("direction") == "in"
    ):
        alert_payload = await run_in_threadpool(
            alerts_router.record_anti_passback_alert,
            event_id=event_row["id"],
            door_id=door_id_eff,
            door_name=door.get("name"),
            member_id=str(decision.member["id"]),
            member_name=decision.member.get("full_name"),
        )

    # ---- Publish SSE events -------------------------------------------------- #
    payload = _build_event_payload(event_row, decision, door, snapshot_path)
    payload["door_opened"] = door_opened
    await bus.publish(payload, event_type="access")
    if alert_payload is not None:
        await bus.publish(alert_payload, event_type="alert")

    # ---- Build response ---------------------------------------------------- #
    member_out: Optional[RecognizeMember] = None
    greeting: Optional[str] = None
    if decision.member:
        member_out = RecognizeMember(
            id=str(decision.member["id"]),
            full_name=decision.member["full_name"],
            department=decision.member.get("department"),
            title=decision.member.get("title"),
        )
        if decision.decision == "granted":
            local_hour = (
                grant_ctx["local_now"].hour if grant_ctx is not None else now.hour
            )
            greeting = _greeting(
                locale, decision.member["full_name"], decision.direction, local_hour
            )

    return RecognizeResult(
        decision=decision.decision,
        member=member_out,
        similarity=decision.similarity,
        door_opened=door_opened,
        greeting=greeting,
        direction=decision.direction,
        reason=decision.reason if decision.decision != "granted" else None,
        day_summary=day_summary,
        message=kiosk_message,
    )


def _safe_direction(door: Optional[dict[str, Any]]) -> str:
    if door and door.get("direction") in ("in", "out"):
        return door["direction"]
    return "unknown"


def _demo_decision(
    door: Optional[dict[str, Any]], threshold: float
) -> Optional[decision_service.Decision]:
    """Fabricate a granted decision for a random active member (demo mode).

    Bypasses the engine entirely; everything downstream (direction inference,
    greetings, day summary, kiosk message, anti-passback) flows through the
    same code as a real recognition. Still honours the debounce so repeated
    demo frames don't double-count attendance.
    """
    member = _pick_demo_member()
    if member is None:
        return None
    door_id = str(door["id"]) if door else None
    min_revisit = settings_router.load_attendance().min_revisit_seconds
    debounced = decision_service._recently_seen(str(member["id"]), door_id, min_revisit)
    # Plausible similarity above threshold for a realistic demo.
    similarity = round(random.uniform(max(threshold, 0.9), 0.99), 4)
    return decision_service.Decision(
        decision="granted",
        direction=_safe_direction(door),
        reason="Demo mode" + (" (debounced)" if debounced else ""),
        member=member,
        similarity=similarity,
        subject_name=member.get("subject_name"),
        debounced=debounced,
    )
