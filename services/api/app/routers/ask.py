"""Ask router — natural questions, answered entirely on the box.

``POST /api/ask { q }`` → ``{ intent, title, columns?, rows?, text?, suggestions? }``

A **deterministic intent parser** (FR + EN keyword/regex patterns; **no LLM, no
cloud**). This is the on-prem answer to "AI questions": it runs pure SQL/stats
over people / departments / zones / attendance — nothing leaves the LAN, and the
same question always yields the same answer.

Supported intents (contract §Ask):
* ``late_count``            — late more than N times over a period
* ``inside_zone``           — everyone currently inside a (fuzzy-matched) zone
* ``overtime_by_department``— overtime (worked − workday length) per department
* ``on_site_now``           — who is on site right now
* ``absent_today``          — active members with no attendance today
* ``earliest_arrivals``     — first ten arrivals today
* ``member_timeline``       — a matched member's door crossings today
* ``unknown``               — with localized example phrasings

Adding an intent = add a matcher to :data:`_INTENTS`; the pipeline tries each in
priority order and returns the first hit. Result rows are built server-side;
values are FR by default and headers follow ``branding.locale`` where trivial.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import unicodedata
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from ..core import db, security
from ..models.schemas import AskRequest, AskResult
from ..services import zones as zones_service
from . import settings as settings_router

logger = logging.getLogger("attendyo.ask")

router = APIRouter(prefix="/api", tags=["ask"])


# --------------------------------------------------------------------------- #
# Localization helpers (headers/titles/text; FR default)
# --------------------------------------------------------------------------- #
def _L(table: dict[str, str], locale: str) -> str:
    return table.get(locale, table["fr"])


_H = {
    "name": {"fr": "Nom", "en": "Name", "ar": "الاسم"},
    "department": {"fr": "Département", "en": "Department", "ar": "القسم"},
    "late": {"fr": "Retards", "en": "Late days", "ar": "مرات التأخر"},
    "zone": {"fr": "Zone", "en": "Zone", "ar": "المنطقة"},
    "overtime": {"fr": "Heures sup.", "en": "Overtime", "ar": "ساعات إضافية"},
    "arrival": {"fr": "Arrivée", "en": "Arrival", "ar": "الوصول"},
    "time": {"fr": "Heure", "en": "Time", "ar": "الوقت"},
    "door": {"fr": "Porte", "en": "Door", "ar": "الباب"},
    "direction": {"fr": "Sens", "en": "Direction", "ar": "الاتجاه"},
}

_DIRECTION_LABEL = {
    "in": {"fr": "Entrée", "en": "Entry", "ar": "دخول"},
    "out": {"fr": "Sortie", "en": "Exit", "ar": "خروج"},
    "unknown": {"fr": "—", "en": "—", "ar": "—"},
}

_PERIOD_LABEL = {
    "today": {"fr": "aujourd'hui", "en": "today", "ar": "اليوم"},
    "week": {"fr": "cette semaine", "en": "this week", "ar": "هذا الأسبوع"},
    "month": {"fr": "ce mois-ci", "en": "this month", "ar": "هذا الشهر"},
}


def _norm(s: str) -> str:
    """Lowercase + strip accents for tolerant FR/EN keyword matching."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().strip()


def _fmt_hours(seconds: float) -> str:
    """'12 h 30' — the duration format used across the product."""
    total_min = int(seconds) // 60
    hours, mins = divmod(total_min, 60)
    return f"{hours} h {mins:02d}"


def _site_tz_name() -> str:
    row = db.query_one("SELECT timezone FROM sites ORDER BY created_at LIMIT 1")
    return (row or {}).get("timezone") or "Africa/Casablanca"


def _workday_seconds() -> int:
    """Site workday length in seconds (workday_end − workday_start)."""
    row = db.query_one(
        "SELECT workday_start, workday_end FROM sites ORDER BY created_at LIMIT 1"
    )
    if not row or not row.get("workday_start") or not row.get("workday_end"):
        return 8 * 3600
    start: dt.time = row["workday_start"]
    end: dt.time = row["workday_end"]
    secs = (end.hour * 3600 + end.minute * 60) - (start.hour * 3600 + start.minute * 60)
    return secs if secs > 0 else 8 * 3600


def _parse_period(qn: str, today: dt.date) -> tuple[dt.date, dt.date, str]:
    """Resolve the period referenced in the question (default month-to-date)."""
    if "aujourd" in qn or "today" in qn:
        return today, today, "today"
    if "semaine" in qn or "week" in qn:
        monday = today - dt.timedelta(days=today.weekday())
        return monday, today, "week"
    return today.replace(day=1), today, "month"


# --------------------------------------------------------------------------- #
# Fuzzy matching (zones / members)
# --------------------------------------------------------------------------- #
def _match_zone(qn: str, zones: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Best zone whose name is referenced in the question (or None)."""
    best: Optional[dict[str, Any]] = None
    best_score = 0
    for z in zones:
        zn = _norm(z["name"])
        if not zn:
            continue
        if zn in qn:
            score = 10 + len(zn)
        else:
            toks = [t for t in re.split(r"\W+", zn) if len(t) >= 3]
            hit = sum(1 for t in toks if re.search(rf"\b{re.escape(t)}\b", qn))
            score = (5 + len(zn)) if toks and hit == len(toks) else 0
        if score > best_score:
            best, best_score = z, score
    return best if best_score >= 5 else None


def _match_member(qn: str, require_cue: bool) -> Optional[dict[str, Any]]:
    """Best member referenced by name. Full-name substring always counts; a
    last-name token only counts when a timeline cue is present (``require_cue``)."""
    members = db.query_all(
        "SELECT id, full_name, department FROM members WHERE status = 'active'"
    )
    best: Optional[dict[str, Any]] = None
    best_len = 0
    for m in members:
        fn = _norm(m["full_name"])
        if fn and fn in qn and len(fn) > best_len:
            best, best_len = m, len(fn)
    if best is not None:
        return best
    if not require_cue:
        return None
    for m in members:
        toks = [t for t in re.split(r"\W+", _norm(m["full_name"])) if len(t) >= 4]
        for t in toks:
            if re.search(rf"\b{re.escape(t)}\b", qn) and len(t) > best_len:
                best, best_len = m, len(t)
    return best


# --------------------------------------------------------------------------- #
# Intent handlers — each returns an AskResult or None (no match)
# --------------------------------------------------------------------------- #
def _intent_late_count(qn: str, locale: str, today: dt.date) -> Optional[AskResult]:
    if "retard" not in qn and "late" not in qn:
        return None
    m = re.search(r"(?:plus de|more than|over|au moins|at least|>)\s*(\d+)", qn)
    if m:
        n = int(m.group(1))
    else:
        m2 = re.search(r"(\d+)\s*(?:fois|times|retards?|late)", qn)
        n = int(m2.group(1)) if m2 else 5
    date_from, date_to, period = _parse_period(qn, today)
    rows = db.query_all(
        """
        SELECT m.full_name, COALESCE(m.department, '—') AS department,
               count(*) AS late_days
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date BETWEEN %s AND %s AND a.is_late
        GROUP BY m.id, m.full_name, m.department
        HAVING count(*) > %s
        ORDER BY late_days DESC, m.full_name ASC
        """,
        (date_from, date_to, n),
    )
    title = {
        "fr": f"En retard plus de {n} fois ({_L(_PERIOD_LABEL[period], 'fr')})",
        "en": f"Late more than {n} times ({_L(_PERIOD_LABEL[period], 'en')})",
        "ar": f"متأخر أكثر من {n} مرات ({_L(_PERIOD_LABEL[period], 'ar')})",
    }
    return AskResult(
        intent="late_count",
        title=_L(title, locale),
        columns=[_L(_H["name"], locale), _L(_H["department"], locale), _L(_H["late"], locale)],
        rows=[[r["full_name"], r["department"], int(r["late_days"])] for r in rows],
    )


def _intent_overtime(qn: str, locale: str, today: dt.date) -> Optional[AskResult]:
    if not (
        "heures sup" in qn or "heure sup" in qn or "supplementaire" in qn
        or "overtime" in qn or ("extra" in qn and "hour" in qn)
    ):
        return None
    date_from, date_to, period = _parse_period(qn, today)
    workday = _workday_seconds()
    rows = db.query_all(
        """
        SELECT COALESCE(m.department, '—') AS department,
               SUM(GREATEST(0, a.worked_seconds - %s)) AS overtime
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date BETWEEN %s AND %s AND a.worked_seconds IS NOT NULL
        GROUP BY COALESCE(m.department, '—')
        HAVING SUM(GREATEST(0, a.worked_seconds - %s)) > 0
        ORDER BY overtime DESC
        """,
        (workday, date_from, date_to, workday),
    )
    title = {
        "fr": f"Heures supplémentaires par département ({_L(_PERIOD_LABEL[period], 'fr')})",
        "en": f"Overtime by department ({_L(_PERIOD_LABEL[period], 'en')})",
        "ar": f"ساعات إضافية حسب القسم ({_L(_PERIOD_LABEL[period], 'ar')})",
    }
    return AskResult(
        intent="overtime_by_department",
        title=_L(title, locale),
        columns=[_L(_H["department"], locale), _L(_H["overtime"], locale)],
        rows=[[r["department"], _fmt_hours(float(r["overtime"] or 0))] for r in rows],
    )


def _intent_earliest(qn: str, locale: str, today: dt.date) -> Optional[AskResult]:
    en = "earliest" in qn or "first in" in qn or "first to arrive" in qn or "arrived first" in qn
    fr = ("arriv" in qn) and ("premier" in qn or "tot" in qn or "matin" in qn)
    if not (en or fr):
        return None
    tz = _site_tz_name()
    rows = db.query_all(
        """
        SELECT m.full_name, COALESCE(m.department, '—') AS department,
               to_char(a.first_in_ts AT TIME ZONE %s, 'HH24:MI') AS arrival
        FROM attendance_days a
        JOIN members m ON m.id = a.member_id AND m.status = 'active'
        WHERE a.work_date = %s AND a.first_in_ts IS NOT NULL
        ORDER BY a.first_in_ts ASC
        LIMIT 10
        """,
        (tz, today),
    )
    title = {"fr": "Premiers arrivés aujourd'hui", "en": "Earliest arrivals today",
             "ar": "أوائل الواصلين اليوم"}
    return AskResult(
        intent="earliest_arrivals",
        title=_L(title, locale),
        columns=[_L(_H["name"], locale), _L(_H["department"], locale), _L(_H["arrival"], locale)],
        rows=[[r["full_name"], r["department"], r["arrival"]] for r in rows],
    )


def _intent_inside_zone(qn: str, locale: str, today: dt.date) -> Optional[AskResult]:
    zones = zones_service.all_zones()
    if not zones:
        return None
    zone = _match_zone(qn, zones)
    if zone is None:
        return None
    subtree = zones_service.subtree_ids(zone["id"], zones)
    people = zones_service.people_on_site(today)
    inside = [p for p in people if p.get("zone_id") and p["zone_id"] in subtree]
    title = {"fr": f"Personnes dans {zone['name']}", "en": f"People inside {zone['name']}",
             "ar": f"الأشخاص داخل {zone['name']}"}
    text = {
        "fr": f"{len(inside)} personne(s) actuellement dans {zone['name']}.",
        "en": f"{len(inside)} person(s) currently inside {zone['name']}.",
        "ar": f"{len(inside)} شخص حاليا داخل {zone['name']}.",
    }
    return AskResult(
        intent="inside_zone",
        title=_L(title, locale),
        text=_L(text, locale),
        columns=[_L(_H["name"], locale), _L(_H["department"], locale), _L(_H["zone"], locale)],
        rows=[[p["member_name"], p.get("department") or "—", p.get("zone_name") or "—"] for p in inside],
    )


def _intent_absent_today(qn: str, locale: str, today: dt.date) -> Optional[AskResult]:
    if "absent" not in qn and "absence" not in qn:
        return None
    rows = db.query_all(
        """
        SELECT m.full_name, COALESCE(m.department, '—') AS department
        FROM members m
        WHERE m.status = 'active'
          AND NOT EXISTS (
              SELECT 1 FROM attendance_days a
              WHERE a.member_id = m.id AND a.work_date = %s
          )
        ORDER BY m.full_name ASC
        """,
        (today,),
    )
    title = {"fr": "Absents aujourd'hui", "en": "Absent today", "ar": "الغائبون اليوم"}
    text = {
        "fr": f"{len(rows)} absent(e)s aujourd'hui.",
        "en": f"{len(rows)} absent today.",
        "ar": f"{len(rows)} غائبون اليوم.",
    }
    return AskResult(
        intent="absent_today",
        title=_L(title, locale),
        text=_L(text, locale),
        columns=[_L(_H["name"], locale), _L(_H["department"], locale)],
        rows=[[r["full_name"], r["department"]] for r in rows],
    )


def _intent_on_site_now(qn: str, locale: str, today: dt.date) -> Optional[AskResult]:
    triggers = [
        "sur site", "present", "presents", "combien de personne", "qui est la",
        "on site", "on-site", "who is here", "who's here", "whos here",
        "currently here", "how many people", "who is in", "qui est present",
    ]
    if not any(t in qn for t in triggers):
        return None
    people = zones_service.people_on_site(today)
    title = {"fr": "Sur site actuellement", "en": "On site right now",
             "ar": "في الموقع الآن"}
    text = {
        "fr": f"{len(people)} personne(s) sur site actuellement.",
        "en": f"{len(people)} person(s) on site right now.",
        "ar": f"{len(people)} شخص في الموقع الآن.",
    }
    return AskResult(
        intent="on_site_now",
        title=_L(title, locale),
        text=_L(text, locale),
        columns=[_L(_H["name"], locale), _L(_H["department"], locale), _L(_H["zone"], locale)],
        rows=[[p["member_name"], p.get("department") or "—", p.get("zone_name") or "—"] for p in people],
    )


def _intent_member_timeline(qn: str, locale: str, today: dt.date) -> Optional[AskResult]:
    cue = any(
        c in qn for c in (
            "parcours", "timeline", "mouvement", "trajet", "deplacement",
            "ou est", "where is", "movements", "track",
        )
    )
    member = _match_member(qn, require_cue=cue)
    if member is None:
        return None
    tz = _site_tz_name()
    rows = db.query_all(
        """
        SELECT to_char(e.ts AT TIME ZONE %s, 'HH24:MI') AS t,
               d.name AS door_name, z.name AS zone_name, e.direction
        FROM access_events e
        LEFT JOIN doors d ON d.id = e.door_id
        LEFT JOIN zones z ON z.id = d.zone_id
        WHERE e.member_id = %s AND e.decision = 'granted'
          AND e.ts >= %s::date AND e.ts < (%s::date + interval '1 day')
        ORDER BY e.ts ASC
        """,
        (tz, str(member["id"]), today, today),
    )
    title = {
        "fr": f"Parcours de {member['full_name']} (aujourd'hui)",
        "en": f"{member['full_name']}'s movements (today)",
        "ar": f"مسار {member['full_name']} (اليوم)",
    }
    out_rows = [
        [
            r["t"], r.get("door_name") or "—", r.get("zone_name") or "—",
            _L(_DIRECTION_LABEL.get(r.get("direction") or "unknown", _DIRECTION_LABEL["unknown"]), locale),
        ]
        for r in rows
    ]
    return AskResult(
        intent="member_timeline",
        title=_L(title, locale),
        columns=[
            _L(_H["time"], locale), _L(_H["door"], locale),
            _L(_H["zone"], locale), _L(_H["direction"], locale),
        ],
        rows=out_rows,
    )


# Priority order: most specific first. Each is ``(qn, locale, today) -> AskResult?``.
_INTENTS: list[Callable[[str, str, dt.date], Optional[AskResult]]] = [
    _intent_late_count,
    _intent_overtime,
    _intent_earliest,
    _intent_inside_zone,
    _intent_absent_today,
    _intent_on_site_now,
    _intent_member_timeline,
]


def _suggestions(locale: str) -> list[str]:
    zrow = db.query_one("SELECT name FROM zones WHERE kind = 'building' ORDER BY name LIMIT 1") \
        or db.query_one("SELECT name FROM zones ORDER BY name LIMIT 1")
    zone_name = (zrow or {}).get("name") or ("Bâtiment B" if locale == "fr" else "Building B")
    examples = {
        "fr": [
            "Qui a été en retard plus de 5 fois ce mois-ci ?",
            f"Qui est dans {zone_name} ?",
            "Quels départements ont le plus d'heures supplémentaires ?",
            "Qui est absent aujourd'hui ?",
            "Qui est arrivé le plus tôt aujourd'hui ?",
        ],
        "en": [
            "Who has been late more than 5 times this month?",
            f"Show everyone currently inside {zone_name}",
            "Which departments have the most overtime?",
            "Who is absent today?",
            "Who arrived earliest today?",
        ],
        "ar": [
            "من تأخر أكثر من 5 مرات هذا الشهر؟",
            f"من داخل {zone_name} الآن؟",
            "أي الأقسام لديها أكثر ساعات إضافية؟",
            "من الغائب اليوم؟",
            "من وصل أولا اليوم؟",
        ],
    }
    return examples.get(locale, examples["fr"])


def _answer(q: str, locale: str) -> AskResult:
    qn = _norm(q)
    today = zones_service.site_local_today()
    if qn:
        for handler in _INTENTS:
            try:
                result = handler(qn, locale, today)
            except Exception as exc:  # one bad intent must not sink the request
                logger.warning("Ask intent %s failed: %s", handler.__name__, exc)
                result = None
            if result is not None:
                return result
    title = {"fr": "Question non comprise", "en": "Question not understood",
             "ar": "لم يتم فهم السؤال"}
    text = {
        "fr": "Essayez l'une de ces questions :",
        "en": "Try one of these questions:",
        "ar": "جرب أحد هذه الأسئلة:",
    }
    return AskResult(
        intent="unknown",
        title=_L(title, locale),
        text=_L(text, locale),
        suggestions=_suggestions(locale),
    )


@router.post("/ask", response_model=AskResult)
async def ask(
    payload: AskRequest,
    _user: dict = Depends(security.get_current_user),
) -> AskResult:
    """Answer a natural-language question locally (deterministic; no LLM)."""
    branding = await run_in_threadpool(settings_router.load_branding)
    return await run_in_threadpool(_answer, payload.q, branding.locale)
