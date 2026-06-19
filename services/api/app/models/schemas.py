"""Request/response schemas.

These mirror the TypeScript ``Core types`` in ``liwan/CONTRACT.md`` field-for-field
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
MemberType = Literal["employee", "resident", "contractor", "visitor"]
MemberStatus = Literal["active", "suspended", "archived"]
Direction = Literal["in", "out", "unknown"]
Decision = Literal["granted", "denied", "unknown_face", "not_authorized", "off_schedule"]
AttendanceStatus = Literal["present", "late", "absent", "incomplete"]
UserRole = Literal["admin", "operator", "viewer"]


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
    id: str
    email: str
    full_name: Optional[str] = None
    role: UserRole
    created_at: datetime


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
    status: Optional[MemberStatus] = None


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
    """Matches contract ``RecognizeResult``."""

    decision: Decision
    member: Optional[RecognizeMember] = None
    similarity: Optional[float] = None
    door_opened: bool = False
    greeting: Optional[str] = None
    direction: Direction = "unknown"


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
    product_name: str = "Liwan"
    tagline: Optional[str] = None
    primary_color: str = "#5663F2"
    accent_color: str = "#E0A340"
    logo_url: Optional[str] = None
    locale: Literal["fr", "en", "ar"] = "fr"


class AttendanceSettings(BaseModel):
    in_out_strategy: str = "first_in_last_out"
    min_revisit_seconds: int = 60
    auto_open_on_grant: bool = True


class SettingsOut(BaseModel):
    branding: Branding
    attendance: AttendanceSettings


class SettingsUpdate(BaseModel):
    """PUT body. Either section may be supplied; omitted sections are unchanged."""

    branding: Optional[Branding] = None
    attendance: Optional[AttendanceSettings] = None


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    compreface: Literal["ok", "down"]
    db: Literal["ok", "down"]
