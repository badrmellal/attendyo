"""Request/response schemas.

These mirror the TypeScript ``Core types`` in ``attendyo/CONTRACT.md`` field-for-field
so the Console/Gate clients deserialize without surprises. Datetimes serialize to
ISO-8601 strings (Pydantic default), matching the ``string`` types in the contract.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Enumerations (kept as Literals to match the contract's string unions)
# --------------------------------------------------------------------------- #
MemberType = Literal[
    "employee", "resident", "contractor", "visitor", "student", "faculty", "staff"
]
MemberStatus = Literal["active", "suspended", "archived"]
Direction = Literal["in", "out", "unknown"]
Decision = Literal["granted", "denied", "unknown_face", "not_authorized", "off_schedule"]
# Wire-only superset for the recognize endpoint: "no_face" is never stored — the
# access_events enum stays exactly ``Decision`` (contract: Smart Gate rules v2.1).
RecognizeDecision = Literal[
    "granted", "denied", "unknown_face", "not_authorized", "off_schedule", "no_face"
]
AttendanceStatus = Literal["present", "late", "absent", "incomplete"]
UserRole = Literal["admin", "operator", "viewer"]
AlertKind = Literal[
    "unknown_face", "not_authorized", "off_schedule", "anti_passback", "system"
]
AlertSeverity = Literal["info", "warning", "critical"]
Terminology = Literal["workforce", "campus", "residence"]


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    # Plain string (not EmailStr) to avoid an email-validator dependency and to
    # accept operator logins that may not be strict RFC-5322 emails.
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """Operator user, as returned by the API. Never carries the password hash."""

    id: str
    email: str
    full_name: Optional[str] = None
    role: UserRole
    created_at: datetime


class UserCreate(BaseModel):
    """``POST /api/users`` body (admin only)."""

    email: str
    full_name: Optional[str] = None
    role: UserRole = "operator"
    password: str = Field(min_length=8, description="Plaintext; stored bcrypt-hashed")


class UserUpdate(BaseModel):
    """``PATCH /api/users/{id}`` body (admin only). Only supplied keys change."""

    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    password: Optional[str] = Field(default=None, min_length=8)


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #
class Member(BaseModel):
    """Matches contract ``Member``."""

    id: str
    external_id: Optional[str] = None
    full_name: str
    subject_name: Optional[str] = None
    member_type: MemberType
    department: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    access_group_id: Optional[str] = None
    photo_url: Optional[str] = None
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    # One-shot door-side note; delivered + cleared on next granted entry.
    kiosk_message: Optional[str] = None
    status: MemberStatus
    created_at: datetime


class MemberUpdate(BaseModel):
    """PATCH body. All fields optional; only supplied keys are updated."""

    external_id: Optional[str] = None
    full_name: Optional[str] = None
    member_type: Optional[MemberType] = None
    department: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    access_group_id: Optional[str] = None
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    # Operator-set one-shot door-side message ("Message d'accueil"). PATCHing it
    # to null clears an undelivered note.
    kiosk_message: Optional[str] = None
    status: Optional[MemberStatus] = None


class ImportLineError(BaseModel):
    """One rejected CSV line during bulk import."""

    line: int
    message: str


class ImportResult(BaseModel):
    """Response of ``POST /api/members/import``."""

    created: int
    skipped: int
    errors: list[ImportLineError] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Access events
# --------------------------------------------------------------------------- #
class AccessEvent(BaseModel):
    """Matches contract ``AccessEvent``."""

    id: int
    ts: datetime
    member_id: Optional[str] = None
    member_name: Optional[str] = None
    subject_name: Optional[str] = None
    similarity: Optional[float] = None
    door_id: Optional[str] = None
    door_name: Optional[str] = None
    direction: Direction
    decision: Decision
    reason: Optional[str] = None
    snapshot_url: Optional[str] = None


# --------------------------------------------------------------------------- #
# Attendance
# --------------------------------------------------------------------------- #
class AttendanceDay(BaseModel):
    """Matches contract ``AttendanceDay``."""

    member_id: str
    member_name: str
    department: Optional[str] = None
    work_date: date
    first_in_ts: Optional[datetime] = None
    last_out_ts: Optional[datetime] = None
    worked_seconds: Optional[int] = None
    is_late: bool = False
    status: AttendanceStatus


# --------------------------------------------------------------------------- #
# Recognition result (the hot path)
# --------------------------------------------------------------------------- #
class RecognizeMember(BaseModel):
    id: str
    full_name: str
    department: Optional[str] = None
    title: Optional[str] = None


class RecognizeResult(BaseModel):
    """Matches contract ``RecognizeResult`` (incl. Smart Gate v2.1 fields)."""

    decision: RecognizeDecision
    member: Optional[RecognizeMember] = None
    similarity: Optional[float] = None
    door_opened: bool = False
    greeting: Optional[str] = None
    direction: Direction = "unknown"
    # Machine reason for denials: "expired" | "not_yet_valid" | …
    reason: Optional[str] = None
    # On exits: localized "8 h 12 sur site aujourd'hui".
    day_summary: Optional[str] = None
    # One-shot door-side note left by an operator (delivered once, then cleared).
    message: Optional[str] = None


# --------------------------------------------------------------------------- #
# Doors & cameras
# --------------------------------------------------------------------------- #
DoorDirection = Literal["in", "out", "both"]
DoorDriverName = Literal["webhook", "pi_gpio", "simulation"]


class Door(BaseModel):
    id: str
    site_id: Optional[str] = None
    name: str
    location: Optional[str] = None
    direction: DoorDirection
    driver: DoorDriverName
    driver_config: dict = Field(default_factory=dict)
    relock_seconds: int
    enabled: bool
    created_at: datetime


class DoorCreate(BaseModel):
    name: str
    site_id: Optional[str] = None
    location: Optional[str] = None
    direction: DoorDirection = "both"
    driver: DoorDriverName = "simulation"
    driver_config: dict = Field(default_factory=dict)
    relock_seconds: int = 5
    enabled: bool = True


class DoorUpdate(BaseModel):
    name: Optional[str] = None
    site_id: Optional[str] = None
    location: Optional[str] = None
    direction: Optional[DoorDirection] = None
    driver: Optional[DoorDriverName] = None
    driver_config: Optional[dict] = None
    relock_seconds: Optional[int] = None
    enabled: Optional[bool] = None


class Camera(BaseModel):
    id: str
    door_id: Optional[str] = None
    name: str
    source: Optional[str] = None
    recognition_threshold: float
    det_prob_threshold: float
    enabled: bool
    created_at: datetime


class CameraCreate(BaseModel):
    name: str
    door_id: Optional[str] = None
    source: Optional[str] = None
    recognition_threshold: float = 0.88
    det_prob_threshold: float = 0.80
    enabled: bool = True


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    door_id: Optional[str] = None
    source: Optional[str] = None
    recognition_threshold: Optional[float] = None
    det_prob_threshold: Optional[float] = None
    enabled: Optional[bool] = None


class AccessGroup(BaseModel):
    id: str
    name: str
    door_ids: list[str] = Field(default_factory=list)
    schedule: dict = Field(default_factory=dict)
    created_at: datetime


class AccessGroupCreate(BaseModel):
    name: str
    door_ids: list[str] = Field(default_factory=list)
    schedule: dict = Field(default_factory=dict)


class AccessGroupUpdate(BaseModel):
    name: Optional[str] = None
    door_ids: Optional[list[str]] = None
    schedule: Optional[dict] = None


# --------------------------------------------------------------------------- #
# Stats
# --------------------------------------------------------------------------- #
class HourlyBucket(BaseModel):
    hour: int
    count: int


class StatsToday(BaseModel):
    present: int
    late: int
    absent: int
    on_site_now: int
    denied_today: int
    total_members: int
    last_in: Optional[AccessEvent] = None
    hourly: list[HourlyBucket] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Settings / branding
# --------------------------------------------------------------------------- #
class Branding(BaseModel):
    product_name: str = "Attendyo"
    tagline: Optional[str] = None
    primary_color: str = "#5663F2"
    accent_color: str = "#E0A340"
    logo_url: Optional[str] = None
    locale: Literal["fr", "en", "ar"] = "fr"
    # UI terminology preset (contract: workforce | campus | residence). The API
    # only stores the preset; labels live in the Console/Gate i18n layer.
    terminology: Terminology = "workforce"


class AttendanceSettings(BaseModel):
    in_out_strategy: str = "first_in_last_out"
    min_revisit_seconds: int = 60
    auto_open_on_grant: bool = True


class SecuritySettings(BaseModel):
    """Contract ``settings.security`` (Smart Gate v2.1)."""

    # At most one alert per (door, kind) within this window; default per contract.
    alert_cooldown_seconds: int = 45


class SettingsOut(BaseModel):
    branding: Branding
    attendance: AttendanceSettings
    security: SecuritySettings


class SettingsUpdate(BaseModel):
    """PUT body. Any section may be supplied; omitted sections are unchanged."""

    branding: Optional[Branding] = None
    attendance: Optional[AttendanceSettings] = None
    security: Optional[SecuritySettings] = None


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    engine: Literal["ok", "down"]
    db: Literal["ok", "down"]


# --------------------------------------------------------------------------- #
# Alerts (v2)
# --------------------------------------------------------------------------- #
class Alert(BaseModel):
    """Matches contract ``Alert``."""

    id: int
    ts: datetime
    kind: AlertKind
    severity: AlertSeverity
    message: str
    event_id: Optional[int] = None
    door_id: Optional[str] = None
    door_name: Optional[str] = None
    member_id: Optional[str] = None
    member_name: Optional[str] = None
    acknowledged: bool = False
    acknowledged_by_email: Optional[str] = None
    acknowledged_at: Optional[datetime] = None


class AlertCount(BaseModel):
    unacknowledged: int


class AckAllResult(BaseModel):
    acknowledged: int


# --------------------------------------------------------------------------- #
# Audit log (v2)
# --------------------------------------------------------------------------- #
class AuditEntry(BaseModel):
    """One append-only audit row (``GET /api/audit``)."""

    id: int
    ts: datetime
    user_email: Optional[str] = None
    action: str
    entity: Optional[str] = None
    entity_id: Optional[str] = None
    details: dict = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Reports & analytics (v2)
# --------------------------------------------------------------------------- #
class ReportDailyBucket(BaseModel):
    date: date
    present: int
    late: int
    absent: int


class ReportSummary(BaseModel):
    """``GET /api/reports/summary`` response."""

    days: int
    avg_present: float
    avg_late: float
    avg_absent: float
    # Fraction 0..1 of arrivals that were on time over the range.
    punctuality_rate: float
    avg_worked_seconds: float
    daily: list[ReportDailyBucket] = Field(default_factory=list)


class DepartmentReport(BaseModel):
    """One row of ``GET /api/reports/departments``."""

    department: str
    members: int
    present_days: int
    late_days: int
    absent_days: int
    avg_worked_seconds: float


class MemberReport(BaseModel):
    """One row of ``GET /api/reports/members``."""

    member_id: str
    member_name: str
    department: Optional[str] = None
    present_days: int
    late_days: int
    absent_days: int
    avg_arrival: Optional[str] = None  # "HH:MM" local, or null if never arrived
    total_worked_seconds: int


# --------------------------------------------------------------------------- #
# Insights — "{product} IQ" (v2.1)
# --------------------------------------------------------------------------- #
InsightKind = Literal[
    "unusual_arrival", "absence_streak", "punctuality_streak", "record_presence"
]


class Insight(BaseModel):
    """Matches contract ``Insight`` (Smart Gate v2.1). Nothing is stored."""

    kind: InsightKind
    member_id: Optional[str] = None
    member_name: Optional[str] = None
    department: Optional[str] = None
    text: str  # ready-to-display FR line, built server-side like alert messages
    date: date  # ISO date the insight refers to


class InsightsOut(BaseModel):
    """``GET /api/insights`` response envelope."""

    insights: list[Insight] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Presence / muster (v2)
# --------------------------------------------------------------------------- #
class PresencePerson(BaseModel):
    member_id: str
    member_name: str
    department: Optional[str] = None
    member_type: MemberType
    first_in_ts: datetime
    first_in_door_name: Optional[str] = None


class PresenceNow(BaseModel):
    """``GET /api/presence/now`` — everyone currently on site."""

    count: int
    people: list[PresencePerson] = Field(default_factory=list)
