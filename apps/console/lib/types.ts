/**
 * Liwan domain types — mirrored exactly from liwan/CONTRACT.md.
 *
 * These are the canonical shapes the Console consumes. Do not diverge from the
 * contract here; if the API needs a different shape, update CONTRACT.md first.
 */

export type MemberType = "employee" | "resident" | "contractor" | "visitor";
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
  status: MemberStatus;
  created_at: string;
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
  decision: AccessDecision;
  member?: { id: string; full_name: string; department?: string; title?: string };
  similarity?: number;
  door_opened: boolean;
  greeting?: string;
  direction: AccessDirection;
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

/** Door driver kinds (liwan/db/schema.sql). */
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

/** Branding tokens — `GET /api/settings → branding`. White-label surface. */
export type Locale = "fr" | "en" | "ar";

export type Branding = {
  product_name: string;
  tagline: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  locale: Locale;
};

export type AttendanceConfig = {
  in_out_strategy: "first_in_last_out";
  min_revisit_seconds: number;
  auto_open_on_grant: boolean;
};

export type Settings = {
  branding: Branding;
  attendance: AttendanceConfig;
};

/** `POST /api/auth/login` */
export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
};

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string;
  role: "admin" | "operator" | "viewer";
};

export type HealthStatus = {
  status: "ok";
  compreface: "ok" | "down";
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
};
