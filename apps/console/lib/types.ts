/**
 * Attendyo domain types — mirrored exactly from attendyo/CONTRACT.md.
 *
 * These are the canonical shapes the Console consumes. Do not diverge from the
 * contract here; if the API needs a different shape, update CONTRACT.md first.
 */

export type MemberType =
  | "employee"
  | "resident"
  | "contractor"
  | "visitor"
  | "student"
  | "faculty"
  | "staff";
export type MemberStatus = "active" | "suspended" | "archived";

export type Member = {
  id: string;
  external_id?: string;
  full_name: string;
  subject_name?: string;
  member_type: MemberType;
  department?: string;
  title?: string;
  email?: string;
  phone?: string;
  access_group_id?: string;
  photo_url?: string;
  /** ISO date — temporary-access window start (visitors/contractors/exchange). */
  valid_from?: string;
  /** ISO date — outside the window → not_authorized, reason "expired". */
  valid_until?: string;
  /** One-shot door-side note; delivered + cleared on next granted entry. */
  kiosk_message?: string;
  status: MemberStatus;
  created_at: string;
};

/**
 * PATCH body for `PATCH /api/members/{id}`. Same as Partial<Member> except the
 * validity window accepts explicit `null` to CLEAR a previously-set bound
 * (omitting the key leaves it untouched on the server).
 */
export type MemberPatch = Omit<Partial<Member>, "valid_from" | "valid_until"> & {
  valid_from?: string | null;
  valid_until?: string | null;
};

export type AccessDirection = "in" | "out" | "unknown";

export type AccessDecision =
  | "granted"
  | "denied"
  | "unknown_face"
  | "not_authorized"
  | "off_schedule";

export type AccessEvent = {
  id: number;
  ts: string;
  member_id?: string;
  member_name?: string;
  subject_name?: string;
  similarity?: number;
  door_id?: string;
  door_name?: string;
  direction: AccessDirection;
  decision: AccessDecision;
  reason?: string;
  snapshot_url?: string;
};

export type AttendanceStatus = "present" | "late" | "absent" | "incomplete";

export type AttendanceDay = {
  member_id: string;
  member_name: string;
  department?: string;
  work_date: string;
  first_in_ts?: string;
  last_out_ts?: string;
  worked_seconds?: number;
  is_late: boolean;
  status: AttendanceStatus;
};

export type RecognizeResult = {
  /** `no_face` exists on the wire only — never stored; kiosks stay idle on it. */
  decision: AccessDecision | "no_face";
  member?: { id: string; full_name: string; department?: string; title?: string };
  similarity?: number;
  door_opened: boolean;
  /** Localized, direction- and time-aware (see Smart Gate rules). */
  greeting?: string;
  direction: AccessDirection;
  /** Machine reason for denials: "expired" | "not_yet_valid" | … */
  reason?: string;
  /** On exits: localized "8 h 12 sur site aujourd'hui". */
  day_summary?: string;
  /** One-shot door-side note left by an operator (see Smart Gate rules). */
  message?: string;
};

/** `GET /api/stats/today` */
export type TodayStats = {
  present: number;
  late: number;
  absent: number;
  on_site_now: number;
  denied_today: number;
  total_members: number;
  last_in?: AccessEvent;
  hourly: { hour: number; count: number }[];
};

/** Door driver kinds (attendyo/db/schema.sql). */
export type DoorDriver = "webhook" | "pi_gpio" | "simulation";
export type DoorDirection = "in" | "out" | "both";

export type Door = {
  id: string;
  site_id?: string;
  name: string;
  location?: string;
  direction: DoorDirection;
  driver: DoorDriver;
  driver_config: Record<string, unknown>;
  relock_seconds: number;
  enabled: boolean;
  created_at: string;
};

export type Camera = {
  id: string;
  door_id?: string;
  name: string;
  source?: string;
  recognition_threshold: number;
  det_prob_threshold: number;
  enabled: boolean;
  created_at: string;
};

/** Week-day keys used by access-group schedules (attendyo/db/schema.sql). */
export type ScheduleDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * Access-group schedule — per-day optional [start, end] "HH:MM" windows.
 * `{}` ⇒ any time. A day absent from the object ⇒ closed that day.
 */
export type Schedule = Partial<Record<ScheduleDay, [string, string]>>;

/**
 * Access group — which doors a member may open, and when (attendyo/db/schema.sql).
 * `door_ids` empty ⇒ all doors; `schedule` `{}` ⇒ any time.
 */
export type AccessGroup = {
  id: string;
  name: string;
  door_ids: string[];
  schedule: Schedule;
  created_at?: string;
};

/** Fields posted to `POST /api/access-groups` (and patched via PATCH). */
export type AccessGroupDraft = {
  name: string;
  door_ids: string[];
  schedule: Schedule;
};

/** Fields posted to `POST /api/doors` (and patched via PATCH). */
export type DoorDraft = {
  name: string;
  location?: string;
  direction: DoorDirection;
  driver: DoorDriver;
  driver_config: Record<string, unknown>;
  relock_seconds: number;
  enabled: boolean;
};

/** Fields posted to `POST /api/cameras` (and patched via PATCH). */
export type CameraDraft = {
  name: string;
  door_id?: string;
  source?: string;
  recognition_threshold: number;
  det_prob_threshold: number;
  enabled: boolean;
};

/** Branding tokens — `GET /api/settings → branding`. White-label surface. */
export type Locale = "fr" | "en" | "ar";

/**
 * Terminology preset — relabels the UI for the customer vertical without a
 * rebuild. The API stores the preset only; labels live in lib/terminology.ts.
 */
export type Terminology = "workforce" | "campus" | "residence";

export type Branding = {
  product_name: string;
  tagline: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  locale: Locale;
  terminology: Terminology;
};

export type AttendanceConfig = {
  in_out_strategy: "first_in_last_out";
  min_revisit_seconds: number;
  auto_open_on_grant: boolean;
};

/** `settings.security` — Smart Gate rules (v2.1). */
export type SecurityConfig = {
  /** At most one alert per (door, kind) per this many seconds (default 45). */
  alert_cooldown_seconds: number;
};

export type Settings = {
  branding: Branding;
  attendance: AttendanceConfig;
  security: SecurityConfig;
};

/** `POST /api/auth/login` */
export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
};

export type OperatorRole = "admin" | "operator" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string;
  role: OperatorRole;
};

export type HealthStatus = {
  /** `degraded` when the DB or the vision engine is unreachable. */
  status: "ok" | "degraded";
  engine: "ok" | "down";
  db: "ok" | "down";
};

/** Filters accepted by `GET /api/members`. */
export type MemberQuery = {
  q?: string;
  status?: MemberStatus;
  department?: string;
  type?: MemberType;
};

/** Fields posted to `POST /api/members` (the single image is attached separately). */
export type MemberDraft = {
  full_name: string;
  external_id?: string;
  member_type: MemberType;
  department?: string;
  title?: string;
  email?: string;
  phone?: string;
  access_group_id?: string;
  valid_from?: string;
  valid_until?: string;
};

// ---------------------------------------------------------------------------
// v2 — Reports & analytics (`GET /api/reports/*`)
// ---------------------------------------------------------------------------

/** One day of the reports summary chart. */
export type ReportsDaily = {
  date: string;
  present: number;
  late: number;
  absent: number;
};

/** `GET /api/reports/summary?from&to` */
export type ReportsSummary = {
  days: number;
  avg_present: number;
  avg_late: number;
  avg_absent: number;
  /** 0..1 — share of attended days that started on time. */
  punctuality_rate: number;
  avg_worked_seconds: number;
  daily: ReportsDaily[];
};

/** `GET /api/reports/departments?from&to` — one row per department. */
export type DepartmentReport = {
  department: string;
  members: number;
  present_days: number;
  late_days: number;
  absent_days: number;
  avg_worked_seconds: number;
};

/** Sort keys accepted by `GET /api/reports/members`. */
export type ReportSort = "late" | "hours" | "absences";

/** `GET /api/reports/members?from&to&sort&limit` — one row per member. */
export type MemberReport = {
  member_id: string;
  member_name: string;
  department?: string;
  present_days: number;
  late_days: number;
  absent_days: number;
  /** "HH:MM" average first-in, or null when never present. */
  avg_arrival: string | null;
  total_worked_seconds: number;
};

// ---------------------------------------------------------------------------
// v2 — Presence / muster (`GET /api/presence/now`)
// ---------------------------------------------------------------------------

export type PresencePerson = {
  member_id: string;
  member_name: string;
  department?: string;
  member_type: MemberType;
  first_in_ts: string;
  first_in_door_name?: string;
};

export type PresenceNow = {
  count: number;
  people: PresencePerson[];
};

// ---------------------------------------------------------------------------
// v2 — Alerts (`GET /api/alerts`, SSE `event: alert`)
// ---------------------------------------------------------------------------

export type AlertKind =
  | "unknown_face"
  | "not_authorized"
  | "off_schedule"
  | "anti_passback"
  | "system";
export type AlertSeverity = "info" | "warning" | "critical";

export type Alert = {
  id: number;
  ts: string;
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  event_id?: number;
  door_id?: string;
  door_name?: string;
  member_id?: string;
  member_name?: string;
  acknowledged: boolean;
  acknowledged_by_email?: string;
  acknowledged_at?: string;
};

/** Filters accepted by `GET /api/alerts`. */
export type AlertQuery = {
  acknowledged?: boolean;
  kind?: AlertKind;
  limit?: number;
};

// ---------------------------------------------------------------------------
// v2.1 — Insights, "{product} IQ" (`GET /api/insights`, operator+)
// Local behavioural intelligence — pure SQL/stats on the box, no cloud, no ML.
// ---------------------------------------------------------------------------

export type InsightKind =
  | "unusual_arrival" // today ≥60min later than their 30-day median (beyond grace)
  | "absence_streak" // ≥3 consecutive workdays absent
  | "punctuality_streak" // ≥10 consecutive on-time days (celebrate it)
  | "record_presence"; // today's on-site peak is a 30-day high (site-level)

export type Insight = {
  kind: InsightKind;
  member_id?: string;
  member_name?: string;
  department?: string;
  /** Ready-to-display FR line, built server-side like alert messages. */
  text: string;
  /** ISO date the insight refers to. */
  date: string;
};

// ---------------------------------------------------------------------------
// v2 — Audit log (`GET /api/audit`, admin only, append-only)
// ---------------------------------------------------------------------------

export type AuditEntry = {
  id: number;
  ts: string;
  user_email?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  details: Record<string, unknown>;
};

/** Filters accepted by `GET /api/audit`. */
export type AuditQuery = {
  limit?: number;
  action?: string;
  user?: string;
};

// ---------------------------------------------------------------------------
// v2 — Team / operator users (`/api/users`, admin only)
// ---------------------------------------------------------------------------

export type OperatorUser = {
  id: string;
  email: string;
  full_name?: string;
  role: OperatorRole;
  created_at: string;
};

/** `POST /api/users` */
export type UserDraft = {
  email: string;
  full_name?: string;
  role: OperatorRole;
  password: string;
};

/** `PATCH /api/users/{id}` */
export type UserPatch = {
  full_name?: string;
  role?: OperatorRole;
  password?: string;
};

// ---------------------------------------------------------------------------
// v2 — Bulk import (`POST /api/members/import`)
// ---------------------------------------------------------------------------

export type ImportError = { line: number; message: string };

export type ImportResult = {
  created: number;
  skipped: number;
  errors: ImportError[];
};
