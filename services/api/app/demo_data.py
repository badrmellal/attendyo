"""Demo dataset generator.

Builds a realistic small organisation so the Console dashboard, attendance sheet,
live monitor and the Gate kiosk all have something to show with zero cameras and
no CompreFace engine (pair with ``LIWAN_DEMO_MODE=1``).

Produces:
* 1 site (HQ Casablanca, 09:00–18:00, 10-min grace).
* 2 doors — a main entrance ("in") and a staff exit ("out"), both simulation.
* ~18 members across departments (employees, a contractor, a visitor).
* A week of ``attendance_days`` with believable morning-in / evening-out times,
  some late arrivals, and a few absences.
* ~60 ``access_events`` spread across *today* for the live feed and stats.

Everything is **idempotent**: re-running clears and rebuilds the demo set without
touching operator users or settings. Subject names are recorded so demo-mode
recognition can pick a random active member.
"""

from __future__ import annotations

import datetime as dt
import logging
import random
import re
import uuid
from typing import Any, Optional

from .core import db

logger = logging.getLogger("liwan.demo")

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
    """Remove prior demo rows (members cascade to attendance/events)."""
    db.execute("DELETE FROM attendance_days")
    db.execute("DELETE FROM access_events")
    db.execute("DELETE FROM members")
    db.execute("DELETE FROM cameras")
    db.execute("DELETE FROM doors")
    db.execute("DELETE FROM sites")


def _create_site() -> dict[str, Any]:
    return db.execute_returning(
        """
        INSERT INTO sites (name, timezone, workday_start, workday_end, grace_minutes)
        VALUES ('Siège Casablanca', 'Africa/Casablanca', '09:00', '18:00', 10)
        RETURNING id, timezone, workday_start, grace_minutes
        """
    )


def _create_doors(site_id: str) -> list[dict[str, Any]]:
    entrance = db.execute_returning(
        """
        INSERT INTO doors (site_id, name, location, direction, driver, driver_config,
                           relock_seconds, enabled)
        VALUES (%s, 'Entrée Principale', 'Hall RDC', 'in', 'simulation', '{}'::jsonb, 5, TRUE)
        RETURNING id, name, direction
        """,
        (site_id,),
    )
    exit_door = db.execute_returning(
        """
        INSERT INTO doors (site_id, name, location, direction, driver, driver_config,
                           relock_seconds, enabled)
        VALUES (%s, 'Sortie Personnel', 'Couloir B', 'out', 'simulation', '{}'::jsonb, 5, TRUE)
        RETURNING id, name, direction
        """,
        (site_id,),
    )
    return [entrance, exit_door]


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

        # A couple of non-employee types for variety.
        n = len(members)
        if n == target - 1:
            member_type, dept_val, title_val = "visitor", None, "Visiteur"
        elif n == target - 2:
            member_type, dept_val, title_val = "contractor", "Informatique", "Prestataire"
        else:
            member_type, dept_val, title_val = "employee", dept, title

        db.execute(
            """
            INSERT INTO members (id, external_id, full_name, subject_name, member_type,
                                 department, title, email, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'active')
            """,
            (
                member_id,
                f"EMP-{1000 + n}",
                full_name,
                subject,
                member_type,
                dept_val,
                title_val,
                f"{first.lower()}.{re.sub(r'[^a-z]', '', last.lower())}@demo.liwan.local",
            ),
        )
        members.append(
            {"id": member_id, "full_name": full_name, "department": dept_val,
             "subject_name": subject, "member_type": member_type}
        )
    return members


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

    # A week of history (including today).
    for day_offset in range(6, -1, -1):
        work_date = today - dt.timedelta(days=day_offset)
        # Skip weekends in the demo (Sat=5, Sun=6).
        if work_date.weekday() >= 5:
            continue
        is_today = work_date == today

        for member in members:
            # ~12% chance absent on a given weekday; visitors more sporadic.
            absent_chance = 0.30 if member["member_type"] == "visitor" else 0.12
            if _RNG.random() < absent_chance:
                continue  # absent — no attendance row, surfaced by read layer

            # Morning arrival: mostly 08:30–09:05, sometimes late to ~09:45.
            late_today = _RNG.random() < 0.18
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

    # A handful of denied / unknown events today for a realistic feed.
    _seed_today_denials(entrance, today, tz)


def _seed_today_denials(entrance: dict[str, Any], today: dt.date, tz) -> None:
    """Add a few unknown_face / off_schedule events today."""
    base = dt.datetime.combine(today, dt.time(9, 0), tzinfo=tz)
    for _ in range(_RNG.randint(8, 14)):
        when = (base + dt.timedelta(minutes=_RNG.randint(0, 540))).astimezone(dt.timezone.utc)
        decision = _RNG.choice(["unknown_face", "unknown_face", "off_schedule"])
        db.execute(
            """
            INSERT INTO access_events
                (ts, member_id, subject_name, similarity, door_id, direction,
                 decision, reason)
            VALUES (%s, NULL, NULL, %s, %s, 'in', %s, %s)
            """,
            (
                when,
                round(_RNG.uniform(0.40, 0.80), 4),
                entrance["id"],
                decision,
                "Unrecognised visitor" if decision == "unknown_face" else "Outside permitted hours",
            ),
        )


def seed_all() -> dict[str, Any]:
    """Wipe and rebuild the full demo dataset. Returns a small summary."""
    _clear_demo()
    site = _create_site()
    doors = _create_doors(site["id"])
    _create_camera(doors[0]["id"])
    members = _create_members()
    _seed_attendance_and_events(site, members, doors)

    summary = {
        "site": site["id"],
        "doors": [d["id"] for d in doors],
        "members": len(members),
        "events_today": (db.query_one(
            "SELECT count(*) AS c FROM access_events WHERE ts::date = current_date"
        ) or {"c": 0})["c"],
    }
    logger.info("Demo dataset seeded: %s", summary)
    return summary
