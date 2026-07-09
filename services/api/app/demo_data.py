"""Demo dataset generator.

Builds a realistic small organisation so the Console dashboard, attendance sheet,
live monitor, reports, presence view, alerts and the Gate kiosk all have
something to show with zero cameras and no recognition engine (pair with
``ATTENDYO_DEMO_MODE=1``).

Produces:
* 1 site (HQ Casablanca, 09:00–18:00, 10-min grace).
* 2 doors — a main entrance ("in") and a staff exit ("out"), both simulation.
* ~18 members across departments, including (v2):
  - a **visitor whose validity window already expired** (``valid_until`` in the
    past) — triggers the "expired" decision path,
  - a **contractor with a future window** (``valid_from`` ahead) — triggers
    "not_yet_valid".
* A week of ``attendance_days`` with believable morning-in / evening-out times,
  some late arrivals, and a few absences.
* ~60 ``access_events`` spread across *today* for the live feed and stats.
* Unacknowledged ``alerts`` linked to today's denied events (v2).
* A few representative ``audit_log`` rows (v2, tagged ``demo``).
* One **operator** and one **viewer** login next to the admin (v2).

Everything is **idempotent**: re-running clears and rebuilds the demo set without
touching real operator users or settings. Subject names are recorded so demo-mode
recognition can pick a random active member.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import random
import re
import uuid
from typing import Any, Optional

from .core import db, security

logger = logging.getLogger("attendyo.demo")

# Extra demo operator logins (created idempotently, never overwritten).
DEMO_USERS = [
    ("operator@attendyo.local", "attendyo-operator", "Opératrice Démo", "operator"),
    ("viewer@attendyo.local", "attendyo-viewer", "Observateur Démo", "viewer"),
]

# Deterministic-ish but varied; fixed seed keeps demos reproducible.
_RNG = random.Random(1404)

_DEPARTMENTS = [
    ("Direction", ["Directeur Général", "Assistante de Direction"]),
    ("Finance", ["Responsable Financier", "Comptable", "Analyste"]),
    ("Ressources Humaines", ["Responsable RH", "Chargé de Recrutement"]),
    ("Informatique", ["Ingénieur Système", "Développeur", "Support IT"]),
    ("Sécurité", ["Chef de Sécurité", "Agent de Sécurité"]),
    ("Opérations", ["Responsable Opérations", "Agent Opérations"]),
]

# Moroccan-context names for a believable roster.
_FIRST_NAMES = [
    "Youssef", "Fatima", "Mehdi", "Salma", "Omar", "Khadija", "Anas", "Imane",
    "Reda", "Nawal", "Hamza", "Sara", "Karim", "Houda", "Bilal", "Loubna",
    "Tarik", "Meriem", "Ayoub", "Zineb",
]
_LAST_NAMES = [
    "El Amrani", "Benani", "Tazi", "El Fassi", "Bennani", "Cherkaoui", "Idrissi",
    "El Khattabi", "Berrada", "Sefrioui", "Ouazzani", "Lahlou", "El Yousfi",
    "Sebti", "Bouhaddou", "Naciri", "El Alaoui", "Chraibi",
]


def _slug(name: str, member_id: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-") or "member"
    return f"{base}-{member_id.split('-')[0]}"


def _clear_demo() -> None:
    """Remove prior demo rows (members cascade to attendance/events).

    Alerts are demo-generated on a demo box, so the table is rebuilt wholesale;
    audit rows are only removed when tagged ``demo`` — real operator actions
    stay append-only.
    """
    db.execute("DELETE FROM alerts")
    db.execute("DELETE FROM audit_log WHERE details->>'demo' = 'true'")
    # v3 spatial: energy_log cascades from energy_rules, energy_rules from zones,
    # but delete explicitly (clear order-independent). doors.zone_id is SET NULL.
    db.execute("DELETE FROM energy_log")
    db.execute("DELETE FROM energy_rules")
    db.execute("DELETE FROM attendance_days")
    db.execute("DELETE FROM access_events")
    db.execute("DELETE FROM members")
    db.execute("DELETE FROM cameras")
    db.execute("DELETE FROM doors")
    db.execute("DELETE FROM zones")
    db.execute("DELETE FROM sites")


def _create_site() -> dict[str, Any]:
    return db.execute_returning(
        """
        INSERT INTO sites (name, timezone, workday_start, workday_end, grace_minutes)
        VALUES ('Siège Casablanca', 'Africa/Casablanca', '09:00', '18:00', 10)
        RETURNING id, timezone, workday_start, grace_minutes
        """
    )


def _create_zones() -> dict[str, dict[str, Any]]:
    """Two buildings and their floors (the v3 spatial tree).

    Siège (A) holds the entrance/exit floors; the empty ``2e étage A`` has no
    door and is the clean target for the energy-off demo. Annexe (B) is where a
    slice of the on-site roster is currently located, so ``inside Building B``,
    occupancy and the live map all have real data.
    """
    def mk(name: str, kind: str, parent_id: Optional[str],
           capacity: Optional[int], energy_kw: Optional[float]) -> dict[str, Any]:
        return db.execute_returning(
            """
            INSERT INTO zones (name, kind, parent_id, capacity, energy_kw)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, name, kind, parent_id
            """,
            (name, kind, parent_id, capacity, energy_kw),
        )

    a = mk("Siège", "building", None, 120, None)
    b = mk("Annexe", "building", None, 60, None)
    return {
        "A": a,
        "B": b,
        "RDC_A": mk("Rez-de-chaussée A", "floor", a["id"], 45, 6.0),
        "ET1_A": mk("1er étage A", "floor", a["id"], 45, 5.5),
        "ET2_A": mk("2e étage A", "floor", a["id"], 40, 5.0),
        "RDC_B": mk("Rez-de-chaussée B", "floor", b["id"], 40, 4.0),
    }


def _create_doors(site_id: str, zones: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    entrance = db.execute_returning(
        """
        INSERT INTO doors (site_id, name, location, direction, driver, driver_config,
                           relock_seconds, enabled, zone_id)
        VALUES (%s, 'Entrée Principale', 'Hall RDC', 'in', 'simulation', '{}'::jsonb, 5, TRUE, %s)
        RETURNING id, name, direction, zone_id
        """,
        (site_id, zones["RDC_A"]["id"]),
    )
    exit_door = db.execute_returning(
        """
        INSERT INTO doors (site_id, name, location, direction, driver, driver_config,
                           relock_seconds, enabled, zone_id)
        VALUES (%s, 'Sortie Personnel', 'Couloir B', 'out', 'simulation', '{}'::jsonb, 5, TRUE, %s)
        RETURNING id, name, direction, zone_id
        """,
        (site_id, zones["ET1_A"]["id"]),
    )
    annexe = db.execute_returning(
        """
        INSERT INTO doors (site_id, name, location, direction, driver, driver_config,
                           relock_seconds, enabled, zone_id)
        VALUES (%s, 'Passerelle Annexe', 'Annexe RDC', 'in', 'simulation', '{}'::jsonb, 5, TRUE, %s)
        RETURNING id, name, direction, zone_id
        """,
        (site_id, zones["RDC_B"]["id"]),
    )
    return [entrance, exit_door, annexe]


def _create_camera(door_id: str) -> None:
    db.execute(
        """
        INSERT INTO cameras (door_id, name, source, recognition_threshold,
                             det_prob_threshold, enabled)
        VALUES (%s, 'Caméra Entrée', '0', 0.88, 0.80, TRUE)
        """,
        (door_id,),
    )


def _create_members() -> list[dict[str, Any]]:
    members: list[dict[str, Any]] = []
    used_names: set[str] = set()
    target = 18
    idx = 0
    today = dt.date.today()
    while len(members) < target:
        dept, titles = _DEPARTMENTS[idx % len(_DEPARTMENTS)]
        idx += 1
        first = _RNG.choice(_FIRST_NAMES)
        last = _RNG.choice(_LAST_NAMES)
        full_name = f"{first} {last}"
        if full_name in used_names:
            continue
        used_names.add(full_name)

        member_id = str(uuid.uuid4())
        subject = _slug(full_name, member_id)
        title = _RNG.choice(titles)

        # A couple of non-employee types for variety, exercising the v2
        # temporary-access windows.
        n = len(members)
        valid_from: Optional[dt.date] = None
        valid_until: Optional[dt.date] = None
        if n == target - 1:
            # Visitor whose badge already expired → "not_authorized/expired".
            member_type, dept_val, title_val = "visitor", None, "Visiteur"
            valid_from = today - dt.timedelta(days=24)
            valid_until = today - dt.timedelta(days=10)
        elif n == target - 2:
            # Contractor whose mission starts next week → "not_yet_valid".
            member_type, dept_val, title_val = "contractor", "Informatique", "Prestataire"
            valid_from = today + dt.timedelta(days=7)
            valid_until = today + dt.timedelta(days=37)
        else:
            member_type, dept_val, title_val = "employee", dept, title

        db.execute(
            """
            INSERT INTO members (id, external_id, full_name, subject_name, member_type,
                                 department, title, email, valid_from, valid_until, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'active')
            """,
            (
                member_id,
                f"EMP-{1000 + n}",
                full_name,
                subject,
                member_type,
                dept_val,
                title_val,
                f"{first.lower()}.{re.sub(r'[^a-z]', '', last.lower())}@demo.attendyo.local",
                valid_from,
                valid_until,
            ),
        )
        members.append(
            {"id": member_id, "full_name": full_name, "department": dept_val,
             "subject_name": subject, "member_type": member_type,
             "valid_from": valid_from, "valid_until": valid_until}
        )
    return members


def _within_window(member: dict[str, Any], day: dt.date) -> bool:
    """Whether ``day`` falls inside the member's validity window."""
    vf, vu = member.get("valid_from"), member.get("valid_until")
    if vf and day < vf:
        return False
    if vu and day > vu:
        return False
    return True


def _casablanca_tz():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("Africa/Casablanca")
    except Exception:  # pragma: no cover
        return dt.timezone.utc


def _attendance_status(first_in_local: dt.datetime, last_out_local: Optional[dt.datetime],
                       grace_cutoff: dt.time) -> tuple[bool, str]:
    is_late = first_in_local.time() > grace_cutoff
    if last_out_local is not None:
        return is_late, ("late" if is_late else "present")
    return is_late, ("late" if is_late else "incomplete")


def _seed_attendance_and_events(
    site: dict[str, Any],
    members: list[dict[str, Any]],
    doors: list[dict[str, Any]],
) -> None:
    tz = _casablanca_tz()
    entrance = next((d for d in doors if d["direction"] == "in"), doors[0])
    exit_door = next((d for d in doors if d["direction"] == "out"), doors[-1])
    grace_cutoff = dt.time(9, 10)  # 09:00 + 10 min grace
    today = dt.datetime.now(tz).date()

    # Two "chronically late" personas (by roster index) so questions like
    # "who has been late more than 5 times this month?" return real rows on any
    # realistic demo day — they arrive late almost every workday.
    chronic_late_idx = {1, 2}

    # ~5 weeks of history (including today) so month-to-date and 30-day windows
    # for reports / insights / Ask all have enough data to be interesting.
    for day_offset in range(34, -1, -1):
        work_date = today - dt.timedelta(days=day_offset)
        # Skip weekends in the demo (Sat=5, Sun=6).
        if work_date.weekday() >= 5:
            continue
        is_today = work_date == today

        for idx, member in enumerate(members):
            # Members outside their validity window can't have entered that day.
            if not _within_window(member, work_date):
                continue
            chronic = idx in chronic_late_idx
            # ~12% chance absent on a given weekday; visitors more sporadic;
            # the chronic-late personas are reliably present (so they rack up lates).
            absent_chance = 0.30 if member["member_type"] == "visitor" else 0.12
            if not chronic and _RNG.random() < absent_chance:
                continue  # absent — no attendance row, surfaced by read layer

            # Morning arrival: mostly 08:30–09:05, sometimes late to ~09:45.
            # Chronic personas are late ~90% of days.
            late_today = _RNG.random() < (0.9 if chronic else 0.18)
            if late_today:
                in_minute = _RNG.randint(11, 46)  # after the 09:10 cutoff
            else:
                in_minute = _RNG.randint(-30, 8)  # 08:30–09:08
            first_in_local = dt.datetime.combine(work_date, dt.time(9, 0), tzinfo=tz) \
                + dt.timedelta(minutes=in_minute)

            # Evening departure 17:30–19:00; for today, only if it's already past.
            out_local: Optional[dt.datetime] = None
            now_local = dt.datetime.now(tz)
            departed = (not is_today) or (_RNG.random() < 0.45)
            if departed:
                out_minute = _RNG.randint(-30, 60)
                candidate = dt.datetime.combine(work_date, dt.time(18, 0), tzinfo=tz) \
                    + dt.timedelta(minutes=out_minute)
                if not is_today or candidate < now_local:
                    out_local = candidate

            is_late, status = _attendance_status(first_in_local, out_local, grace_cutoff)
            worked_seconds = (
                int((out_local - first_in_local).total_seconds())
                if out_local and out_local > first_in_local else None
            )

            first_in_utc = first_in_local.astimezone(dt.timezone.utc)
            out_utc = out_local.astimezone(dt.timezone.utc) if out_local else None

            db.execute(
                """
                INSERT INTO attendance_days
                    (member_id, work_date, site_id, first_in_ts, last_out_ts,
                     first_in_door, last_out_door, worked_seconds, is_late, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (member_id, work_date) DO NOTHING
                """,
                (
                    member["id"], work_date, site["id"], first_in_utc, out_utc,
                    entrance["id"], exit_door["id"] if out_utc else None,
                    worked_seconds, is_late, status,
                ),
            )

            # Today: also write the granted access events that produced the row,
            # so the live monitor and hourly histogram are populated.
            if is_today:
                sim = round(_RNG.uniform(0.90, 0.99), 4)
                db.execute(
                    """
                    INSERT INTO access_events
                        (ts, member_id, subject_name, similarity, door_id, direction,
                         decision, reason)
                    VALUES (%s,%s,%s,%s,%s,'in','granted',NULL)
                    """,
                    (first_in_utc, member["id"], member["subject_name"], sim, entrance["id"]),
                )
                # Midday movement: most people pop out for lunch and return.
                # These extra in/out grants enrich today's live feed and the
                # hourly histogram without changing the canonical first/last row.
                if _RNG.random() < 0.75:
                    lunch_out_local = dt.datetime.combine(
                        work_date, dt.time(12, 0), tzinfo=tz
                    ) + dt.timedelta(minutes=_RNG.randint(-20, 40))
                    lunch_in_local = lunch_out_local + dt.timedelta(
                        minutes=_RNG.randint(35, 75)
                    )
                    if lunch_out_local > first_in_local and (
                        out_local is None or lunch_in_local < out_local
                    ):
                        for when_local, direction, dr in (
                            (lunch_out_local, "out", exit_door),
                            (lunch_in_local, "in", entrance),
                        ):
                            db.execute(
                                """
                                INSERT INTO access_events
                                    (ts, member_id, subject_name, similarity, door_id,
                                     direction, decision, reason)
                                VALUES (%s,%s,%s,%s,%s,%s,'granted',NULL)
                                """,
                                (
                                    when_local.astimezone(dt.timezone.utc),
                                    member["id"], member["subject_name"],
                                    round(_RNG.uniform(0.90, 0.99), 4),
                                    dr["id"], direction,
                                ),
                            )

                if out_utc:
                    sim2 = round(_RNG.uniform(0.90, 0.99), 4)
                    db.execute(
                        """
                        INSERT INTO access_events
                            (ts, member_id, subject_name, similarity, door_id, direction,
                             decision, reason)
                        VALUES (%s,%s,%s,%s,%s,'out','granted',NULL)
                        """,
                        (out_utc, member["id"], member["subject_name"], sim2, exit_door["id"]),
                    )

    # A handful of denied / unknown events today (with alerts) for a realistic feed.
    _seed_today_denials(entrance, today, tz, members)


# Mirrors app.routers.alerts: severity + plain-French message per alert kind.
_ALERT_SEVERITY = {"unknown_face": "warning", "not_authorized": "warning", "off_schedule": "info"}


def _insert_denial_with_alert(
    *,
    when_utc: dt.datetime,
    decision: str,
    reason: Optional[str],
    entrance: dict[str, Any],
    message: str,
    member: Optional[dict[str, Any]] = None,
    similarity: Optional[float] = None,
) -> None:
    """One denied access_event plus its (unacknowledged) linked alert."""
    event = db.execute_returning(
        """
        INSERT INTO access_events
            (ts, member_id, subject_name, similarity, door_id, direction,
             decision, reason)
        VALUES (%s, %s, %s, %s, %s, 'in', %s, %s)
        RETURNING id
        """,
        (
            when_utc,
            member["id"] if member else None,
            member["subject_name"] if member else None,
            similarity,
            entrance["id"],
            decision,
            reason,
        ),
    )
    db.execute(
        """
        INSERT INTO alerts (ts, kind, severity, message, event_id, door_id, member_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            when_utc,
            decision,
            _ALERT_SEVERITY.get(decision, "warning"),
            message,
            event["id"] if event else None,
            entrance["id"],
            member["id"] if member else None,
        ),
    )


def _seed_today_denials(
    entrance: dict[str, Any], today: dt.date, tz, members: list[dict[str, Any]]
) -> None:
    """Add a few unknown_face / off_schedule / expired events today, each with
    an unacknowledged alert so the Console badge and alert list demo well."""
    base = dt.datetime.combine(today, dt.time(9, 0), tzinfo=tz)
    door_name = entrance.get("name") or "porte inconnue"
    for _ in range(_RNG.randint(8, 14)):
        when = (base + dt.timedelta(minutes=_RNG.randint(0, 540))).astimezone(dt.timezone.utc)
        decision = _RNG.choice(["unknown_face", "unknown_face", "off_schedule"])
        _insert_denial_with_alert(
            when_utc=when,
            decision=decision,
            reason=(
                "Unrecognised visitor" if decision == "unknown_face"
                else "Outside permitted hours"
            ),
            entrance=entrance,
            message=(
                f"Visage inconnu à {door_name}" if decision == "unknown_face"
                else f"Accès hors horaire pour inconnu à {door_name}"
            ),
            similarity=round(_RNG.uniform(0.40, 0.80), 4),
        )

    # The expired visitor tried to come back this morning → "expired" denial.
    expired = next(
        (m for m in members
         if m.get("valid_until") and m["valid_until"] < today), None,
    )
    if expired is not None:
        when = (base + dt.timedelta(minutes=_RNG.randint(15, 90))).astimezone(dt.timezone.utc)
        _insert_denial_with_alert(
            when_utc=when,
            decision="not_authorized",
            reason="expired",
            entrance=entrance,
            message=(
                f"Accès non autorisé pour {expired['full_name']} à {door_name} "
                "(accès expiré)"
            ),
            member=expired,
            similarity=round(_RNG.uniform(0.90, 0.99), 4),
        )


def _ensure_demo_users() -> None:
    """Create the demo operator + viewer logins (idempotent, never overwrites)."""
    for email, password, full_name, role in DEMO_USERS:
        existing = db.query_one(
            "SELECT 1 FROM users WHERE lower(email) = lower(%s)", (email,)
        )
        if existing:
            continue
        db.execute(
            "INSERT INTO users (email, password_hash, full_name, role) "
            "VALUES (%s, %s, %s, %s)",
            (email, security.hash_password(password), full_name, role),
        )
        logger.info("Seeded demo %s user %s", role, email)


def _seed_audit(members: list[dict[str, Any]], doors: list[dict[str, Any]]) -> None:
    """A few representative audit rows so /api/audit demos with content.

    Every row is tagged ``{"demo": true}`` so re-seeding can remove exactly
    these and nothing an actual operator did.
    """
    admin = db.query_one(
        "SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"
    )
    operator = db.query_one(
        "SELECT id, email FROM users WHERE role = 'operator' ORDER BY created_at LIMIT 1"
    ) or admin
    if admin is None:
        return

    sample_member = members[0] if members else None
    entrance = doors[0] if doors else None
    entries: list[tuple[dict[str, Any], str, Optional[str], Optional[str], dict[str, Any]]] = [
        (admin, "login", "user", str(admin["id"]), {}),
        (operator, "login", "user", str(operator["id"]), {}),
    ]
    if sample_member:
        entries.append(
            (operator, "member.create", "member", str(sample_member["id"]),
             {"full_name": sample_member["full_name"]})
        )
    if entrance:
        entries.append(
            (operator, "door.open", "door", str(entrance["id"]),
             {"opened": True, "manual": True})
        )
    entries.append((admin, "settings.update", "settings", None, {"sections": ["branding"]}))

    for user, action, entity, entity_id, details in entries:
        details = {**details, "demo": True}
        db.execute(
            """
            INSERT INTO audit_log (ts, user_id, user_email, action, entity, entity_id, details)
            VALUES (now() - (%s || ' minutes')::interval, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                str(_RNG.randint(5, 600)),
                str(user["id"]),
                user["email"],
                action,
                entity,
                entity_id,
                json.dumps(details),
            ),
        )


def _seed_zone_movements(doors: list[dict[str, Any]]) -> None:
    """Move a slice of the on-site roster into the Annexe (Building B).

    Current zone = the zone of a member's most recent granted event today. By
    inserting a recent granted *in* at the Annexe door for every third on-site
    member, those people's current zone becomes Building B — so occupancy, the
    live map and the Ask "inside Building B" question all have real data, and a
    couple within the 15-minute window register as congestion.
    """
    annexe = next((d for d in doors if d.get("name") == "Passerelle Annexe"), None)
    if annexe is None:
        return
    tz = _casablanca_tz()
    today = dt.datetime.now(tz).date()
    # Each move is stamped just AFTER that member's own latest event today, so it
    # is reliably their most-recent granted event → current zone = Annexe — no
    # matter what wall-clock time the demo is seeded at (the roster writes a full
    # synthetic day, incl. midday events that could otherwise dominate).
    on_site = db.query_all(
        """
        SELECT a.member_id, m.subject_name,
               (SELECT max(e.ts) FROM access_events e
                WHERE e.member_id = a.member_id AND e.decision = 'granted'
                  AND e.ts >= %s::date) AS last_ts
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date = %s
          AND a.first_in_ts IS NOT NULL
          AND (a.last_out_ts IS NULL OR a.last_out_ts <= a.first_in_ts)
        ORDER BY a.first_in_ts ASC
        """,
        (today, today),
    )
    for row in on_site[::3]:
        base = row.get("last_ts") or dt.datetime.now(dt.timezone.utc)
        when_utc = base + dt.timedelta(minutes=_RNG.randint(2, 10))
        db.execute(
            """
            INSERT INTO access_events
                (ts, member_id, subject_name, similarity, door_id, direction,
                 decision, reason)
            VALUES (%s, %s, %s, %s, %s, 'in', 'granted', NULL)
            """,
            (
                when_utc, row["member_id"], row["subject_name"],
                round(_RNG.uniform(0.90, 0.99), 4), annexe["id"],
            ),
        )


def _create_energy_rules(zones: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """One rule on the always-empty 2e étage (the evaluator turns it OFF live)
    and one on the occupied Annexe (stays ON) — a clear before/after demo."""
    rules: list[dict[str, Any]] = []
    rules.append(
        db.execute_returning(
            """
            INSERT INTO energy_rules (zone_id, name, empty_minutes, driver,
                                      driver_config, enabled, state)
            VALUES (%s, 'CVC 2e étage', 15, 'simulation', '{}'::jsonb, TRUE, 'on')
            RETURNING id, zone_id, name
            """,
            (zones["ET2_A"]["id"],),
        )
    )
    rules.append(
        db.execute_returning(
            """
            INSERT INTO energy_rules (zone_id, name, empty_minutes, driver,
                                      driver_config, enabled, state)
            VALUES (%s, 'Éclairage Annexe', 30, 'simulation', '{}'::jsonb, TRUE, 'on')
            RETURNING id, zone_id, name
            """,
            (zones["B"]["id"],),
        )
    )
    return rules


def _seed_energy_history(rules: list[dict[str, Any]], zones: dict[str, Any]) -> None:
    """Closed energy_log episodes for the 2e-étage rule over recent workdays so
    the savings card ("kWh économisés ce mois") is non-zero out of the box."""
    rule = next((r for r in rules if str(r["zone_id"]) == str(zones["ET2_A"]["id"])), None)
    if rule is None:
        return
    tz = _casablanca_tz()
    today = dt.datetime.now(tz).date()
    for offset in range(1, 8):
        day = today - dt.timedelta(days=offset)
        if day.weekday() >= 5:  # skip weekends
            continue
        # An empty stretch on that day (e.g. after-hours), 2–5 h long.
        off_local = dt.datetime.combine(day, dt.time(18, 30), tzinfo=tz) \
            + dt.timedelta(minutes=_RNG.randint(-40, 40))
        on_local = off_local + dt.timedelta(
            hours=_RNG.randint(2, 5), minutes=_RNG.randint(0, 59)
        )
        db.execute(
            """
            INSERT INTO energy_log (rule_id, went_off_at, back_on_at)
            VALUES (%s, %s, %s)
            """,
            (
                rule["id"],
                off_local.astimezone(dt.timezone.utc),
                on_local.astimezone(dt.timezone.utc),
            ),
        )


def seed_all() -> dict[str, Any]:
    """Wipe and rebuild the full demo dataset. Returns a small summary."""
    _clear_demo()
    _ensure_demo_users()
    site = _create_site()
    zones = _create_zones()
    doors = _create_doors(site["id"], zones)
    _create_camera(doors[0]["id"])
    members = _create_members()
    _seed_attendance_and_events(site, members, doors)
    _seed_zone_movements(doors)
    energy_rules = _create_energy_rules(zones)
    _seed_energy_history(energy_rules, zones)
    _seed_audit(members, doors)

    summary = {
        "site": site["id"],
        "doors": [d["id"] for d in doors],
        "zones": len(zones),
        "energy_rules": len(energy_rules),
        "members": len(members),
        "events_today": (db.query_one(
            "SELECT count(*) AS c FROM access_events WHERE ts::date = current_date"
        ) or {"c": 0})["c"],
        "alerts_open": (db.query_one(
            "SELECT count(*) AS c FROM alerts WHERE NOT acknowledged"
        ) or {"c": 0})["c"],
        "audit_rows": (db.query_one(
            "SELECT count(*) AS c FROM audit_log WHERE details->>'demo' = 'true'"
        ) or {"c": 0})["c"],
    }
    logger.info("Demo dataset seeded: %s", summary)
    return summary
