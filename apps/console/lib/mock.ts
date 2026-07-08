/**
 * Offline mock layer.
 *
 * Active when `NEXT_PUBLIC_MOCK=1` or when the real API is unreachable. It
 * produces realistic, internally-consistent demo data so the entire Console
 * renders beautifully without a backend — the way it gets reviewed.
 *
 * Everything here is deterministic relative to "now" so the dashboard always
 * looks alive (recent timestamps, plausible hourly curve, a live feed that
 * keeps ticking).
 */

import type {
  AccessDecision,
  AccessEvent,
  AccessGroup,
  AccessGroupDraft,
  Alert,
  AlertKind,
  AlertQuery,
  AttendanceDay,
  AuditEntry,
  AuditQuery,
  Branding,
  Camera,
  DepartmentReport,
  Door,
  Insight,
  Member,
  MemberReport,
  OperatorUser,
  PresenceNow,
  ReportSort,
  ReportsDaily,
  ReportsSummary,
  Settings,
  TodayStats,
  UserDraft,
  UserPatch,
} from "./types";
import { shiftDate, todayISO } from "./utils";

/**
 * Stable id generator for newly-created mock rows. Uses crypto.randomUUID when
 * available, falling back to a counter-based pseudo-UUID so the demo also works
 * in older runtimes / SSR.
 */
let idCounter = 900_000;
export function mockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idCounter += 1;
  const hex = idCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex.slice(-12)}`;
}

// --------------------------------------------------------------------------
// Seed people — a believable mixed-tenant building (offices + a bank branch).
// --------------------------------------------------------------------------
type Seed = {
  name: string;
  dept: string;
  title: string;
  type: Member["member_type"];
  status?: Member["status"];
  /** Days relative to today for the temporary-access window (v2). */
  validFromDays?: number;
  validUntilDays?: number;
  /** One-shot door-side message pending delivery (v2.1 Smart Gate). */
  kioskMessage?: string;
};

const SEED_PEOPLE: Seed[] = [
  { name: "Yasmine El Amrani", dept: "Direction", title: "Directrice Générale", type: "employee" },
  { name: "Omar Benjelloun", dept: "Sécurité", title: "Chef de Sécurité", type: "employee" },
  { name: "Salma Tazi", dept: "Ressources Humaines", title: "Responsable RH", type: "employee", kioskMessage: "Réunion déplacée à 14 h — salle B" },
  { name: "Karim Idrissi", dept: "Opérations", title: "Directeur des Opérations", type: "employee" },
  { name: "Nadia Bennani", dept: "Finance", title: "Contrôleuse de Gestion", type: "employee" },
  { name: "Youssef Alaoui", dept: "IT", title: "Administrateur Systèmes", type: "employee" },
  { name: "Hajar Chraibi", dept: "Finance", title: "Comptable", type: "employee", kioskMessage: "Passez au bureau RH signer votre fiche de paie" },
  { name: "Mehdi Lahlou", dept: "Opérations", title: "Superviseur", type: "employee" },
  { name: "Imane Sefrioui", dept: "Accueil", title: "Hôtesse d'Accueil", type: "employee" },
  { name: "Rachid Berrada", dept: "Sécurité", title: "Agent de Sécurité", type: "employee" },
  { name: "Fatima Zahra Ouazzani", dept: "Ressources Humaines", title: "Chargée de Recrutement", type: "employee" },
  { name: "Anas El Fassi", dept: "IT", title: "Ingénieur DevOps", type: "employee" },
  { name: "Loubna Kettani", dept: "Direction", title: "Assistante de Direction", type: "employee" },
  { name: "Hamza Squalli", dept: "Opérations", title: "Technicien", type: "employee" },
  { name: "Sara Mernissi", dept: "Finance", title: "Analyste Financière", type: "employee" },
  { name: "Bilal Naciri", dept: "IT", title: "Développeur", type: "employee" },
  { name: "Aicha Bouhlal", dept: "Accueil", title: "Réceptionniste", type: "employee" },
  { name: "Tariq Ghali", dept: "Sécurité", title: "Agent de Nuit", type: "employee", status: "suspended" },
  { name: "Meryem Daoudi", dept: "Ressources Humaines", title: "Gestionnaire Paie", type: "employee" },
  { name: "Zakaria Benslimane", dept: "Opérations", title: "Coordinateur", type: "employee" },
  { name: "ATLAS Maintenance", dept: "Prestataires", title: "Maintenance HVAC", type: "contractor", validFromDays: -30, validUntilDays: 60 },
  { name: "Said Ouatar", dept: "Prestataires", title: "Nettoyage", type: "contractor" },
  { name: "Leila Hassani", dept: "Visiteurs", title: "Auditrice Externe", type: "visitor", validFromDays: -14, validUntilDays: -2 },
  { name: "Marc Dubois", dept: "Visiteurs", title: "Consultant", type: "visitor", status: "archived", validFromDays: -90, validUntilDays: -60 },
];

function uuid(seed: number): string {
  // Deterministic, collision-free pseudo-UUID per seed: the seed is embedded
  // directly, so distinct seeds always yield distinct ids. (Mock data only.)
  // The previous version multiplied + sliced high hex digits, which made
  // seed and 16*seed collide (e.g. uuid(1) === uuid(16)).
  const s = (seed >>> 0).toString(16).padStart(8, "0");
  return `${s}-0000-4000-8000-${s}0000`;
}

const NOW = Date.now();

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

export const MOCK_MEMBERS: Member[] = SEED_PEOPLE.map((p, i) => ({
  id: uuid(i + 1),
  external_id: `EMP-${String(1000 + i)}`,
  full_name: p.name,
  subject_name: `subject_${i + 1}`,
  member_type: p.type,
  department: p.dept,
  title: p.title,
  email:
    p.type === "contractor" || p.type === "visitor"
      ? undefined
      : `${p.name.toLowerCase().replace(/[^a-z]+/g, ".")}@entreprise.ma`,
  phone: `+212 6${String(10000000 + i * 137).slice(0, 8)}`,
  valid_from: p.validFromDays != null ? shiftDate(todayISO(), p.validFromDays) : undefined,
  valid_until: p.validUntilDays != null ? shiftDate(todayISO(), p.validUntilDays) : undefined,
  kiosk_message: p.kioskMessage,
  status: p.status ?? "active",
  created_at: iso(-1000 * 60 * 60 * 24 * (30 + i)),
}));

const DEPARTMENTS = Array.from(
  new Set(MOCK_MEMBERS.map((m) => m.department).filter(Boolean) as string[]),
).sort();

export const MOCK_DEPARTMENTS = DEPARTMENTS;

// --------------------------------------------------------------------------
// Doors & cameras
// --------------------------------------------------------------------------
export const MOCK_DOORS: Door[] = [
  {
    id: uuid(101),
    name: "Entrée Principale",
    location: "Rez-de-chaussée — Hall",
    direction: "both",
    driver: "webhook",
    driver_config: { url: "http://10.0.0.20/relay", method: "POST" },
    relock_seconds: 5,
    enabled: true,
    created_at: iso(-1000 * 60 * 60 * 24 * 120),
  },
  {
    id: uuid(102),
    name: "Porte Parking",
    location: "Sous-sol — Niveau -1",
    direction: "in",
    driver: "pi_gpio",
    driver_config: { pin: 17, active_high: true },
    relock_seconds: 8,
    enabled: true,
    created_at: iso(-1000 * 60 * 60 * 24 * 110),
  },
  {
    id: uuid(103),
    name: "Salle des Coffres",
    location: "1er étage — Zone sécurisée",
    direction: "both",
    driver: "simulation",
    driver_config: {},
    relock_seconds: 3,
    enabled: true,
    created_at: iso(-1000 * 60 * 60 * 24 * 90),
  },
  {
    id: uuid(104),
    name: "Sortie de Secours",
    location: "Rez-de-chaussée — Est",
    direction: "out",
    driver: "simulation",
    driver_config: {},
    relock_seconds: 5,
    enabled: false,
    created_at: iso(-1000 * 60 * 60 * 24 * 80),
  },
];

export const MOCK_CAMERAS: Camera[] = [
  {
    id: uuid(201),
    door_id: MOCK_DOORS[0].id,
    name: "Cam Hall — Entrée",
    source: "rtsp://10.0.0.31:554/stream1",
    recognition_threshold: 0.88,
    det_prob_threshold: 0.8,
    enabled: true,
    created_at: iso(-1000 * 60 * 60 * 24 * 120),
  },
  {
    id: uuid(202),
    door_id: MOCK_DOORS[1].id,
    name: "Cam Parking",
    source: "rtsp://10.0.0.32:554/stream1",
    recognition_threshold: 0.86,
    det_prob_threshold: 0.78,
    enabled: true,
    created_at: iso(-1000 * 60 * 60 * 24 * 110),
  },
  {
    id: uuid(203),
    door_id: MOCK_DOORS[2].id,
    name: "Cam Coffres",
    source: "rtsp://10.0.0.33:554/stream1",
    recognition_threshold: 0.92,
    det_prob_threshold: 0.85,
    enabled: true,
    created_at: iso(-1000 * 60 * 60 * 24 * 90),
  },
];

// --------------------------------------------------------------------------
// Attendance — deterministic but lively, for ANY work date. Each date gets its
// own seed shift so navigating the date picker shows plausibly different days;
// weekends are empty (everyone absent), past days are fully clocked out.
// --------------------------------------------------------------------------
const WORKDAY = todayISO();

/** Small deterministic per-date offset so each day looks different. */
function dateSeed(dateISO: string): number {
  let h = 0;
  for (let i = 0; i < dateISO.length; i++) h = (h * 31 + dateISO.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function makeAttendance(dateISO: string = WORKDAY): AttendanceDay[] {
  const seed = dateSeed(dateISO);
  const isToday = dateISO === WORKDAY;
  const dow = new Date(`${dateISO}T12:00:00`).getDay(); // 0=Sun … 6=Sat
  // Historical weekends are empty; TODAY always looks alive so the demo (and
  // the presence/muster view) never opens on a dead screen.
  const weekend = (dow === 0 || dow === 6) && !isToday;

  return MOCK_MEMBERS.map((m, idx) => {
    const i = idx + (seed % 13); // per-date shuffle of who is late/absent
    // Archived/suspended/visitors mostly absent; spread the rest.
    const inactive = m.status !== "active";
    const isVisitorOrContractor =
      m.member_type === "visitor" || m.member_type === "contractor";

    let status: AttendanceDay["status"];
    if (inactive || weekend) status = "absent";
    else if (i % 9 === 4) status = "absent";
    else if (i % 7 === 3) status = "late";
    else if (isToday && i % 11 === 6) status = "incomplete";
    else status = "present";

    if (!weekend && isVisitorOrContractor && i % 2 === 0) status = "absent";

    if (status === "absent") {
      return {
        member_id: m.id,
        member_name: m.full_name,
        department: m.department,
        work_date: dateISO,
        is_late: false,
        status,
      };
    }

    const baseInMin = status === "late" ? 9 * 60 + 28 + (i % 20) : 8 * 60 + 35 + (i % 25);
    const inDate = new Date(`${dateISO}T00:00:00`);
    inDate.setMinutes(baseInMin);

    const hasOut = status !== "incomplete";
    const outDate = new Date(inDate);
    outDate.setMinutes(outDate.getMinutes() + 8 * 60 + 5 + (i % 40));

    const worked = hasOut
      ? Math.round((outDate.getTime() - inDate.getTime()) / 1000)
      : undefined;

    return {
      member_id: m.id,
      member_name: m.full_name,
      department: m.department,
      work_date: dateISO,
      first_in_ts: inDate.toISOString(),
      last_out_ts: hasOut ? outDate.toISOString() : undefined,
      worked_seconds: worked,
      is_late: status === "late",
      status,
    };
  });
}

export const MOCK_ATTENDANCE: AttendanceDay[] = makeAttendance();

/**
 * Date-aware mock for GET /api/attendance: honors `date`, `from`/`to` ranges,
 * and `member_id`, mirroring the live API's selection semantics.
 */
export function mockAttendanceFor(params: {
  date?: string;
  from?: string;
  to?: string;
  member_id?: string;
} = {}): AttendanceDay[] {
  let rows: AttendanceDay[];
  if (params.from && params.to && params.from !== params.to) {
    rows = [];
    // Walk the range (bounded to 92 days like the API) newest-first.
    const start = new Date(`${params.from}T12:00:00`);
    const end = new Date(`${params.to}T12:00:00`);
    for (let d = new Date(end), n = 0; d >= start && n < 92; d.setDate(d.getDate() - 1), n++) {
      rows.push(...makeAttendance(d.toISOString().slice(0, 10)));
    }
  } else {
    rows = makeAttendance(params.date ?? params.from ?? WORKDAY);
  }
  if (params.member_id) rows = rows.filter((r) => r.member_id === params.member_id);
  return rows;
}

/**
 * "Still on site" rule shared by the dashboard stat and /presence: the person
 * clocked in today and either has no out yet, or their (mock) out time is still
 * in the future — so during the working day most present people are on site,
 * and in the evening the list drains naturally.
 */
function isOnSiteNow(a: AttendanceDay): boolean {
  if (!a.first_in_ts || a.status === "absent") return false;
  if (new Date(a.first_in_ts).getTime() > Date.now()) return false;
  if (!a.last_out_ts) return true;
  return new Date(a.last_out_ts).getTime() > Date.now();
}

// --------------------------------------------------------------------------
// Access events — a backlog plus a generator for the live stream.
// --------------------------------------------------------------------------
const DECISION_WEIGHTS: [AccessDecision, number][] = [
  ["granted", 78],
  ["denied", 4],
  ["unknown_face", 8],
  ["not_authorized", 6],
  ["off_schedule", 4],
];

function pickDecision(rng: number): AccessDecision {
  const total = DECISION_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = (rng % total) + 0.0001;
  for (const [decision, w] of DECISION_WEIGHTS) {
    if (r <= w) return decision;
    r -= w;
  }
  return "granted";
}

const REASONS: Partial<Record<AccessDecision, string>> = {
  unknown_face: "No subject above threshold",
  not_authorized: "Door not in access group",
  off_schedule: "Outside permitted hours",
  denied: "Member suspended",
};

let eventCounter = 50_000;

function buildEvent(atMs: number, seed: number): AccessEvent {
  const decision = pickDecision(seed);
  const door = MOCK_DOORS[seed % MOCK_DOORS.length];
  const known = decision !== "unknown_face";
  const member = known ? MOCK_MEMBERS[seed % MOCK_MEMBERS.length] : undefined;
  const direction =
    door.direction === "in" ? "in" : door.direction === "out" ? "out" : seed % 2 === 0 ? "in" : "out";

  const similarity =
    decision === "unknown_face"
      ? 0.4 + (seed % 30) / 100
      : 0.86 + (seed % 13) / 100;

  return {
    id: eventCounter++,
    ts: new Date(atMs).toISOString(),
    member_id: member?.id,
    member_name: member?.full_name,
    subject_name: member?.subject_name,
    similarity: Math.min(0.999, similarity),
    door_id: door.id,
    door_name: door.name,
    direction,
    decision,
    reason: REASONS[decision],
  };
}

export const MOCK_EVENTS: AccessEvent[] = Array.from({ length: 60 }, (_, i) =>
  buildEvent(NOW - i * 1000 * 60 * (3 + (i % 5)), i * 7 + 3),
).sort((a, b) => +new Date(b.ts) - +new Date(a.ts));

/** Generate one fresh "live" event for the SSE simulation. */
export function nextLiveEvent(): AccessEvent {
  return buildEvent(Date.now(), Math.floor(Math.random() * 9973));
}

// --------------------------------------------------------------------------
// Dashboard stats — derived from the mock attendance for consistency.
// --------------------------------------------------------------------------
export function mockTodayStats(): TodayStats {
  const present = MOCK_ATTENDANCE.filter((a) => a.status === "present").length;
  const late = MOCK_ATTENDANCE.filter((a) => a.status === "late").length;
  const incomplete = MOCK_ATTENDANCE.filter((a) => a.status === "incomplete").length;
  const absent = MOCK_ATTENDANCE.filter((a) => a.status === "absent").length;
  const deniedToday = MOCK_EVENTS.filter(
    (e) => e.decision !== "granted" && new Date(e.ts).toDateString() === new Date().toDateString(),
  ).length;

  // On-site now: entered and not yet left (their last-out is still ahead).
  const onSiteNow = MOCK_ATTENDANCE.filter(isOnSiteNow).length;

  // Hourly entries curve — a believable office day (peak 8-9, dip midday).
  const shape = [0, 0, 0, 0, 0, 0, 1, 4, 14, 9, 5, 6, 8, 7, 5, 4, 6, 9, 7, 3, 1, 1, 0, 0];
  const hourly = shape.map((count, hour) => ({ hour, count }));

  const lastIn = MOCK_EVENTS.find((e) => e.decision === "granted" && e.direction === "in");

  return {
    present: present + incomplete,
    late,
    absent,
    on_site_now: onSiteNow,
    denied_today: deniedToday,
    total_members: MOCK_MEMBERS.filter((m) => m.status === "active").length,
    last_in: lastIn,
    hourly,
  };
}

// --------------------------------------------------------------------------
// Settings / branding — defaults straight from brand/BRAND.md & schema seed.
// --------------------------------------------------------------------------
export const MOCK_BRANDING: Branding = {
  product_name: "Attendyo",
  tagline: "The face is the key.",
  primary_color: "#5663F2",
  accent_color: "#E0A340",
  logo_url: null,
  locale: "fr",
  terminology: "workforce",
};

export const MOCK_SETTINGS: Settings = {
  branding: MOCK_BRANDING,
  attendance: {
    in_out_strategy: "first_in_last_out",
    min_revisit_seconds: 60,
    auto_open_on_grant: true,
  },
  security: {
    alert_cooldown_seconds: 45,
  },
};

// In-memory mutable copy so Settings edits "stick" within a session.
let liveSettings: Settings = JSON.parse(JSON.stringify(MOCK_SETTINGS));

export function getMockSettings(): Settings {
  return JSON.parse(JSON.stringify(liveSettings));
}

export function putMockSettings(next: Settings): Settings {
  liveSettings = JSON.parse(JSON.stringify(next));
  return getMockSettings();
}

// --------------------------------------------------------------------------
// Access groups — full CRUD demo set (doors + per-day schedule windows).
// `door_ids` empty ⇒ all doors; `schedule` {} ⇒ any time.
// --------------------------------------------------------------------------
export const MOCK_ACCESS_GROUPS: AccessGroup[] = [
  {
    id: uuid(301),
    name: "Accès complet",
    door_ids: [],
    schedule: {},
    created_at: iso(-1000 * 60 * 60 * 24 * 120),
  },
  {
    id: uuid(302),
    name: "Employés — Bureaux",
    door_ids: [MOCK_DOORS[0].id, MOCK_DOORS[1].id],
    schedule: {},
    created_at: iso(-1000 * 60 * 60 * 24 * 110),
  },
  {
    id: uuid(303),
    name: "Direction & Coffres",
    door_ids: [MOCK_DOORS[0].id, MOCK_DOORS[2].id],
    schedule: {},
    created_at: iso(-1000 * 60 * 60 * 24 * 90),
  },
  {
    id: uuid(304),
    name: "Prestataires — Heures ouvrées",
    door_ids: [MOCK_DOORS[0].id],
    schedule: {
      mon: ["08:00", "18:00"],
      tue: ["08:00", "18:00"],
      wed: ["08:00", "18:00"],
      thu: ["08:00", "18:00"],
      fri: ["08:00", "17:00"],
    },
    created_at: iso(-1000 * 60 * 60 * 24 * 60),
  },
];

let liveAccessGroups: AccessGroup[] = MOCK_ACCESS_GROUPS.map((g) => ({ ...g }));

export function getMockAccessGroups(): AccessGroup[] {
  return liveAccessGroups.map((g) => ({ ...g }));
}

export function addMockAccessGroup(draft: AccessGroupDraft): AccessGroup {
  const group: AccessGroup = {
    id: mockId(),
    name: draft.name,
    door_ids: [...draft.door_ids],
    schedule: { ...draft.schedule },
    created_at: new Date().toISOString(),
  };
  liveAccessGroups = [...liveAccessGroups, group];
  return { ...group };
}

export function updateMockAccessGroup(id: string, patch: Partial<AccessGroupDraft>): AccessGroup {
  const idx = liveAccessGroups.findIndex((g) => g.id === id);
  if (idx === -1) throw new Error("Access group not found");
  const next: AccessGroup = { ...liveAccessGroups[idx], ...patch, id };
  liveAccessGroups = liveAccessGroups.map((g) => (g.id === id ? next : g));
  return { ...next };
}

export function deleteMockAccessGroup(id: string): void {
  liveAccessGroups = liveAccessGroups.filter((g) => g.id !== id);
  // Members referencing the group lose it (schema: ON DELETE SET NULL).
  liveMembers = liveMembers.map((m) =>
    m.access_group_id === id ? { ...m, access_group_id: undefined } : m,
  );
}

// --------------------------------------------------------------------------
// In-memory MEMBERS — create / read / update / delete so the demo mutates.
// --------------------------------------------------------------------------
let liveMembers: Member[] = MOCK_MEMBERS.map((m, i) => ({
  ...m,
  // Sprinkle a few access-group assignments so the edit form shows real values.
  access_group_id:
    m.member_type === "contractor"
      ? MOCK_ACCESS_GROUPS[3].id
      : i % 3 === 0
        ? MOCK_ACCESS_GROUPS[1].id
        : undefined,
}));

export function getMockMembers(): Member[] {
  return [...liveMembers];
}

export function addMockMember(m: Member): Member {
  liveMembers = [m, ...liveMembers];
  return m;
}

export function updateMockMember(id: string, patch: Partial<Member>): Member {
  const idx = liveMembers.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error("Member not found");
  const next = { ...liveMembers[idx], ...patch, id };
  liveMembers = liveMembers.map((m) => (m.id === id ? next : m));
  return next;
}

export function deleteMockMember(id: string): void {
  liveMembers = liveMembers.filter((m) => m.id !== id);
}

// --------------------------------------------------------------------------
// In-memory DOORS — create / read / update / delete.
// --------------------------------------------------------------------------
let liveDoors: Door[] = [...MOCK_DOORS];

export function getMockDoors(): Door[] {
  return [...liveDoors];
}

export function addMockDoor(door: Door): Door {
  liveDoors = [...liveDoors, door];
  return door;
}

export function updateMockDoor(id: string, patch: Partial<Door>): Door {
  const idx = liveDoors.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error("Door not found");
  const next = { ...liveDoors[idx], ...patch, id };
  liveDoors = liveDoors.map((d) => (d.id === id ? next : d));
  return next;
}

export function deleteMockDoor(id: string): void {
  liveDoors = liveDoors.filter((d) => d.id !== id);
  // Cameras cascade on the door (schema: ON DELETE CASCADE).
  liveCameras = liveCameras.filter((c) => c.door_id !== id);
}

// --------------------------------------------------------------------------
// In-memory CAMERAS — create / read / update / delete.
// --------------------------------------------------------------------------
let liveCameras: Camera[] = [...MOCK_CAMERAS];

export function getMockCameras(): Camera[] {
  return [...liveCameras];
}

export function addMockCamera(camera: Camera): Camera {
  liveCameras = [...liveCameras, camera];
  return camera;
}

export function updateMockCamera(id: string, patch: Partial<Camera>): Camera {
  const idx = liveCameras.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("Camera not found");
  const next = { ...liveCameras[idx], ...patch, id };
  liveCameras = liveCameras.map((c) => (c.id === id ? next : c));
  return next;
}

export function deleteMockCamera(id: string): void {
  liveCameras = liveCameras.filter((c) => c.id !== id);
}

// ===========================================================================
// v2 — users, alerts, audit, reports, presence
// ===========================================================================

// --------------------------------------------------------------------------
// Operator users — the Console team (admin / operator / viewer).
// The signed-in demo operator is admin@attendyo.local (see api.ts `me()`).
// --------------------------------------------------------------------------
export const MOCK_SELF_EMAIL = "admin@attendyo.local";

const SEED_USERS: OperatorUser[] = [
  {
    id: uuid(401),
    email: MOCK_SELF_EMAIL,
    full_name: "Administrateur",
    role: "admin",
    created_at: iso(-1000 * 60 * 60 * 24 * 180),
  },
  {
    id: uuid(402),
    email: "s.tazi@entreprise.ma",
    full_name: "Salma Tazi",
    role: "operator",
    created_at: iso(-1000 * 60 * 60 * 24 * 120),
  },
  {
    id: uuid(403),
    email: "o.benjelloun@entreprise.ma",
    full_name: "Omar Benjelloun",
    role: "operator",
    created_at: iso(-1000 * 60 * 60 * 24 * 90),
  },
  {
    id: uuid(404),
    email: "n.bennani@entreprise.ma",
    full_name: "Nadia Bennani",
    role: "viewer",
    created_at: iso(-1000 * 60 * 60 * 24 * 45),
  },
];

let liveUsers: OperatorUser[] = SEED_USERS.map((u) => ({ ...u }));

export function getMockUsers(): OperatorUser[] {
  return liveUsers.map((u) => ({ ...u }));
}

export function addMockUser(draft: UserDraft): OperatorUser {
  if (liveUsers.some((u) => u.email.toLowerCase() === draft.email.toLowerCase())) {
    throw new Error("Un utilisateur avec cet e-mail existe déjà.");
  }
  const user: OperatorUser = {
    id: mockId(),
    email: draft.email,
    full_name: draft.full_name || undefined,
    role: draft.role,
    created_at: new Date().toISOString(),
  };
  liveUsers = [...liveUsers, user];
  appendMockAudit("user.create", "user", user.id, { email: user.email, role: user.role });
  return { ...user };
}

export function updateMockUser(id: string, patch: UserPatch): OperatorUser {
  const idx = liveUsers.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error("User not found");
  const next: OperatorUser = {
    ...liveUsers[idx],
    full_name: patch.full_name !== undefined ? patch.full_name || undefined : liveUsers[idx].full_name,
    role: patch.role ?? liveUsers[idx].role,
  };
  liveUsers = liveUsers.map((u) => (u.id === id ? next : u));
  appendMockAudit("user.update", "user", id, { email: next.email, role: next.role });
  return { ...next };
}

/** Throws with a human message on self-delete / last-admin (API returns 409). */
export function deleteMockUser(id: string): void {
  const user = liveUsers.find((u) => u.id === id);
  if (!user) throw new Error("User not found");
  if (user.email === MOCK_SELF_EMAIL) {
    throw new Error("Vous ne pouvez pas supprimer votre propre compte.");
  }
  if (user.role === "admin" && liveUsers.filter((u) => u.role === "admin").length <= 1) {
    throw new Error("Impossible de supprimer le dernier administrateur.");
  }
  liveUsers = liveUsers.filter((u) => u.id !== id);
  appendMockAudit("user.delete", "user", id, { email: user.email });
}

// --------------------------------------------------------------------------
// Alerts — a believable backlog derived from the non-granted event history,
// plus live creation from the SSE simulation (see recordMockAlert).
// --------------------------------------------------------------------------
const ALERT_SEVERITY: Record<AlertKind, Alert["severity"]> = {
  unknown_face: "critical",
  not_authorized: "warning",
  off_schedule: "warning",
  anti_passback: "info",
  system: "info",
};

const ALERT_MESSAGE: Record<AlertKind, (doorName?: string) => string> = {
  unknown_face: (d) => `Visage inconnu détecté${d ? ` — ${d}` : ""}`,
  not_authorized: (d) => `Tentative d'accès non autorisée${d ? ` — ${d}` : ""}`,
  off_schedule: (d) => `Accès hors horaire${d ? ` — ${d}` : ""}`,
  anti_passback: (d) => `Double entrée détectée${d ? ` — ${d}` : ""}`,
  system: () => "Anomalie système",
};

let alertCounter = 9_000;

function alertFromEvent(ev: AccessEvent, acknowledged: boolean): Alert {
  const kind: AlertKind =
    ev.decision === "unknown_face" || ev.decision === "not_authorized" || ev.decision === "off_schedule"
      ? ev.decision
      : "not_authorized"; // "denied" folds into not_authorized for the demo
  return {
    id: alertCounter++,
    ts: ev.ts,
    kind,
    severity: ALERT_SEVERITY[kind],
    message: ALERT_MESSAGE[kind](ev.door_name),
    event_id: ev.id,
    door_id: ev.door_id,
    door_name: ev.door_name,
    member_id: ev.member_id,
    member_name: kind === "unknown_face" ? undefined : ev.member_name,
    acknowledged,
    acknowledged_by_email: acknowledged ? MOCK_SELF_EMAIL : undefined,
    acknowledged_at: acknowledged ? ev.ts : undefined,
  };
}

// Seed: every non-granted backlog event becomes an alert; older ones are
// already acknowledged so the list shows both states. Plus one soft
// anti-passback (granted double entry at an "in" door — v2.1 Smart Gate)
// and one system alert.
let liveAlerts: Alert[] = [
  ...MOCK_EVENTS.filter((e) => e.decision !== "granted").map((e, i) =>
    alertFromEvent(e, i >= 4),
  ),
  {
    id: alertCounter++,
    ts: iso(-1000 * 60 * 42),
    kind: "anti_passback" as const,
    severity: "info" as const,
    message: `Double entrée : ${MOCK_MEMBERS[3].full_name} est déjà sur site — ${MOCK_DOORS[1].name}`,
    door_id: MOCK_DOORS[1].id,
    door_name: MOCK_DOORS[1].name,
    member_id: MOCK_MEMBERS[3].id,
    member_name: MOCK_MEMBERS[3].full_name,
    acknowledged: false,
  },
  {
    id: alertCounter++,
    ts: iso(-1000 * 60 * 60 * 26),
    kind: "system" as const,
    severity: "info" as const,
    message: "Caméra « Cam Parking » reconnectée après une coupure réseau",
    door_id: MOCK_DOORS[1].id,
    door_name: MOCK_DOORS[1].name,
    acknowledged: true,
    acknowledged_by_email: MOCK_SELF_EMAIL,
    acknowledged_at: iso(-1000 * 60 * 60 * 25),
  },
].sort((a, b) => +new Date(b.ts) - +new Date(a.ts));

export function getMockAlerts(query: AlertQuery = {}): Alert[] {
  let out = liveAlerts.map((a) => ({ ...a }));
  if (query.acknowledged !== undefined) out = out.filter((a) => a.acknowledged === query.acknowledged);
  if (query.kind) out = out.filter((a) => a.kind === query.kind);
  if (query.limit) out = out.slice(0, query.limit);
  return out;
}

export function getMockAlertCount(): { unacknowledged: number } {
  return { unacknowledged: liveAlerts.filter((a) => !a.acknowledged).length };
}

export function ackMockAlert(id: number): Alert {
  const idx = liveAlerts.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error("Alert not found");
  const next: Alert = {
    ...liveAlerts[idx],
    acknowledged: true,
    acknowledged_by_email: MOCK_SELF_EMAIL,
    acknowledged_at: new Date().toISOString(),
  };
  liveAlerts = liveAlerts.map((a) => (a.id === id ? next : a));
  appendMockAudit("alerts.ack", "alert", String(id), { kind: next.kind });
  return { ...next };
}

export function ackAllMockAlerts(): { acknowledged: number } {
  const now = new Date().toISOString();
  const count = liveAlerts.filter((a) => !a.acknowledged).length;
  liveAlerts = liveAlerts.map((a) =>
    a.acknowledged
      ? a
      : { ...a, acknowledged: true, acknowledged_by_email: MOCK_SELF_EMAIL, acknowledged_at: now },
  );
  if (count > 0) appendMockAudit("alerts.ack", "alert", "all", { acknowledged: count });
  return { acknowledged: count };
}

/**
 * Live-stream hook: a fresh non-granted event just "happened" — persist the
 * matching alert so /alerts, the bell badge, and the stream stay consistent.
 */
export function recordMockAlert(ev: AccessEvent): Alert {
  const alert = alertFromEvent(ev, false);
  liveAlerts = [alert, ...liveAlerts];
  return { ...alert };
}

// --------------------------------------------------------------------------
// Audit log — append-only trail of operator actions.
// --------------------------------------------------------------------------
let auditCounter = 70_000;

function seedAudit(): AuditEntry[] {
  const actors = [MOCK_SELF_EMAIL, "s.tazi@entreprise.ma", "o.benjelloun@entreprise.ma"];
  const rows: Omit<AuditEntry, "id" | "ts">[] = [
    { user_email: actors[0], action: "login", entity: "user", details: { ip: "10.0.0.4" } },
    { user_email: actors[0], action: "settings.update", entity: "settings", entity_id: "branding", details: { changed: ["accent_color"] } },
    { user_email: actors[1], action: "member.create", entity: "member", entity_id: MOCK_MEMBERS[15].id, details: { full_name: MOCK_MEMBERS[15].full_name } },
    { user_email: actors[1], action: "member.update", entity: "member", entity_id: MOCK_MEMBERS[7].id, details: { changed: ["department"] } },
    { user_email: actors[2], action: "login", entity: "user", details: { ip: "10.0.0.12" } },
    { user_email: actors[0], action: "door.open", entity: "door", entity_id: MOCK_DOORS[0].id, details: { name: MOCK_DOORS[0].name, manual: true } },
    { user_email: actors[1], action: "alerts.ack", entity: "alert", entity_id: "9003", details: { kind: "unknown_face" } },
    { user_email: actors[0], action: "access_group.update", entity: "access_group", entity_id: MOCK_ACCESS_GROUPS[3].id, details: { changed: ["schedule"] } },
    { user_email: actors[0], action: "user.create", entity: "user", details: { email: "n.bennani@entreprise.ma", role: "viewer" } },
    { user_email: actors[1], action: "member.import", entity: "member", details: { created: 12, skipped: 2 } },
    { user_email: actors[2], action: "login", entity: "user", details: { ip: "10.0.0.12" } },
    { user_email: actors[0], action: "camera.update", entity: "camera", entity_id: MOCK_CAMERAS[2].id, details: { changed: ["recognition_threshold"] } },
    { user_email: actors[1], action: "member.update", entity: "member", entity_id: MOCK_MEMBERS[17].id, details: { changed: ["status"], status: "suspended" } },
    { user_email: actors[0], action: "door.update", entity: "door", entity_id: MOCK_DOORS[3].id, details: { changed: ["enabled"], enabled: false } },
    { user_email: actors[0], action: "login", entity: "user", details: { ip: "10.0.0.4" } },
    { user_email: actors[1], action: "member.delete", entity: "member", details: { full_name: "Test Démo" } },
    { user_email: actors[0], action: "access_group.create", entity: "access_group", entity_id: MOCK_ACCESS_GROUPS[3].id, details: { name: MOCK_ACCESS_GROUPS[3].name } },
    { user_email: actors[2], action: "login", entity: "user", details: { ip: "10.0.0.31" } },
  ];
  // Spread the rows over the last ~10 days, most recent first.
  return rows.map((r, i) => ({
    id: auditCounter++,
    ts: iso(-1000 * 60 * (37 + i * 41 * 19)),
    ...r,
  }));
}

let liveAudit: AuditEntry[] = seedAudit().sort((a, b) => +new Date(b.ts) - +new Date(a.ts));

export function getMockAudit(query: AuditQuery = {}): AuditEntry[] {
  let out = liveAudit.map((a) => ({ ...a }));
  if (query.action) out = out.filter((a) => a.action === query.action);
  if (query.user) {
    const q = query.user.toLowerCase();
    out = out.filter((a) => a.user_email?.toLowerCase().includes(q));
  }
  return out.slice(0, query.limit ?? 100);
}

/** Append an audit row (mock mutations call this so the trail stays alive). */
export function appendMockAudit(
  action: string,
  entity?: string,
  entity_id?: string,
  details: Record<string, unknown> = {},
): AuditEntry {
  const entry: AuditEntry = {
    id: auditCounter++,
    ts: new Date().toISOString(),
    user_email: MOCK_SELF_EMAIL,
    action,
    entity,
    entity_id,
    details,
  };
  liveAudit = [entry, ...liveAudit];
  return { ...entry };
}

// --------------------------------------------------------------------------
// Reports — deterministic aggregates over an arbitrary [from, to] range,
// derived from the member roster so every view stays internally consistent.
// --------------------------------------------------------------------------

/** Small deterministic hash for (string) seeds — stable across renders. */
function seededInt(seed: string, mod: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

function isWeekend(dateISO: string): boolean {
  const d = new Date(`${dateISO}T12:00:00`).getDay();
  return d === 0 || d === 6;
}

/** Inclusive list of ISO dates between from and to (bounded to 366 days). */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 366 && cur <= to; i++) {
    out.push(cur);
    cur = shiftDate(cur, 1);
  }
  return out;
}

/** Workforce eligible for daily attendance in the mock reports. */
function reportRoster(): Member[] {
  return liveMembers.filter((m) => m.status === "active");
}

function dailyBreakdown(dateISO: string): ReportsDaily {
  const roster = reportRoster();
  const n = roster.length;
  if (isWeekend(dateISO)) {
    const skeleton = seededInt(`${dateISO}-we`, 3); // a guard or two
    return { date: dateISO, present: skeleton, late: 0, absent: n - skeleton };
  }
  const absent = 1 + seededInt(`${dateISO}-abs`, Math.max(2, Math.round(n * 0.15)));
  const late = 1 + seededInt(`${dateISO}-late`, Math.max(2, Math.round(n * 0.2)));
  const present = Math.max(0, n - absent - late);
  return { date: dateISO, present, late, absent };
}

export function mockReportsSummary(from: string, to: string): ReportsSummary {
  const days = dateRange(from, to);
  const daily = days.map(dailyBreakdown);
  const workdays = daily.filter((d) => !isWeekend(d.date));
  const base = workdays.length > 0 ? workdays : daily;
  const sum = (f: (d: ReportsDaily) => number) => base.reduce((s, d) => s + f(d), 0);
  const avg = (f: (d: ReportsDaily) => number) =>
    base.length > 0 ? sum(f) / base.length : 0;
  const attended = sum((d) => d.present + d.late);
  return {
    days: days.length,
    avg_present: Math.round(avg((d) => d.present) * 10) / 10,
    avg_late: Math.round(avg((d) => d.late) * 10) / 10,
    avg_absent: Math.round(avg((d) => d.absent) * 10) / 10,
    punctuality_rate: attended > 0 ? sum((d) => d.present) / attended : 1,
    avg_worked_seconds: 7 * 3600 + 50 * 60 + seededInt(`${from}${to}`, 45) * 60,
    daily,
  };
}

export function mockReportsDepartments(from: string, to: string): DepartmentReport[] {
  const workdays = dateRange(from, to).filter((d) => !isWeekend(d)).length || 1;
  const byDept = new Map<string, Member[]>();
  for (const m of reportRoster()) {
    const dept = m.department || "—";
    byDept.set(dept, [...(byDept.get(dept) ?? []), m]);
  }
  return Array.from(byDept.entries())
    .map(([department, members]) => {
      const slots = members.length * workdays;
      const late_days = seededInt(`${department}-${from}-l`, Math.max(2, Math.round(slots * 0.12)));
      const absent_days = seededInt(`${department}-${from}-a`, Math.max(2, Math.round(slots * 0.09)));
      return {
        department,
        members: members.length,
        present_days: Math.max(0, slots - late_days - absent_days),
        late_days,
        absent_days,
        avg_worked_seconds: 7 * 3600 + 30 * 60 + seededInt(`${department}-h`, 80) * 60,
      };
    })
    .sort((a, b) => b.members - a.members);
}

export function mockReportsMembers(
  from: string,
  to: string,
  sort: ReportSort = "late",
  limit = 15,
): MemberReport[] {
  const workdays = dateRange(from, to).filter((d) => !isWeekend(d)).length || 1;
  const rows: MemberReport[] = reportRoster().map((m) => {
    const late_days = seededInt(`${m.id}-${from}-l`, Math.max(2, Math.round(workdays * 0.45)));
    const absent_days = seededInt(`${m.id}-${from}-a`, Math.max(2, Math.round(workdays * 0.25)));
    const present_days = Math.max(0, workdays - late_days - absent_days);
    const attendedDays = present_days + late_days;
    const arrivalMin = 8 * 60 + 25 + seededInt(`${m.id}-arr`, 70);
    return {
      member_id: m.id,
      member_name: m.full_name,
      department: m.department,
      present_days,
      late_days,
      absent_days,
      avg_arrival:
        attendedDays > 0
          ? `${String(Math.floor(arrivalMin / 60)).padStart(2, "0")}:${String(arrivalMin % 60).padStart(2, "0")}`
          : null,
      total_worked_seconds: attendedDays * (7 * 3600 + 40 * 60 + seededInt(`${m.id}-w`, 50) * 60),
    };
  });
  const cmp: Record<ReportSort, (a: MemberReport, b: MemberReport) => number> = {
    late: (a, b) => b.late_days - a.late_days,
    hours: (a, b) => b.total_worked_seconds - a.total_worked_seconds,
    absences: (a, b) => b.absent_days - a.absent_days,
  };
  return rows.sort(cmp[sort]).slice(0, limit);
}

// --------------------------------------------------------------------------
// Presence — who is on site right now, derived from today's attendance.
// --------------------------------------------------------------------------
export function mockPresenceNow(): PresenceNow {
  const memberById = new Map(liveMembers.map((m) => [m.id, m]));
  const people = MOCK_ATTENDANCE.filter(isOnSiteNow)
    .map((a, i) => {
      const member = memberById.get(a.member_id);
      return {
        member_id: a.member_id,
        member_name: a.member_name,
        department: a.department,
        member_type: member?.member_type ?? ("employee" as const),
        first_in_ts: a.first_in_ts as string,
        first_in_door_name: MOCK_DOORS[i % 2].name, // the two street-level doors
      };
    })
    .sort((a, b) => +new Date(a.first_in_ts) - +new Date(b.first_in_ts));
  return { count: people.length, people };
}

// --------------------------------------------------------------------------
// v2.1 — Insights, "{product} IQ" (`GET /api/insights`).
// The real API computes these deterministically from attendance history (pure
// SQL/stats on the box — nothing stored, nothing leaves the server). The mock
// mirrors that: same roster → same lines, covering every insight kind.
// --------------------------------------------------------------------------
export function mockInsights(limit = 10): Insight[] {
  const today = todayISO();
  const yesterday = shiftDate(today, -1);
  const withMember = (m: Member) => ({
    member_id: m.id,
    member_name: m.full_name,
    department: m.department,
  });
  const nadia = MOCK_MEMBERS[4]; // Finance — Contrôleuse de Gestion
  const mehdi = MOCK_MEMBERS[7]; // Opérations — Superviseur
  const imane = MOCK_MEMBERS[8]; // Accueil — Hôtesse d'Accueil
  const anas = MOCK_MEMBERS[11]; // IT — Ingénieur DevOps
  const hamza = MOCK_MEMBERS[13]; // Opérations — Technicien

  const insights: Insight[] = [
    {
      kind: "unusual_arrival",
      ...withMember(nadia),
      text: `${nadia.full_name} est arrivée à 10 h 47 — 1 h 22 plus tard que sa médiane sur 30 jours.`,
      date: today,
    },
    {
      kind: "absence_streak",
      ...withMember(hamza),
      text: `${hamza.full_name} est absent depuis 4 jours ouvrés consécutifs.`,
      date: today,
    },
    {
      kind: "punctuality_streak",
      ...withMember(imane),
      text: `${imane.full_name} enchaîne 16 jours consécutifs à l'heure — série en cours.`,
      date: today,
    },
    {
      kind: "record_presence",
      text: `Record de présence : 21 personnes sur site en même temps — plus haut niveau sur 30 jours.`,
      date: today,
    },
    {
      kind: "unusual_arrival",
      ...withMember(mehdi),
      text: `${mehdi.full_name} est arrivé à 11 h 05 — 2 h 10 plus tard que sa médiane sur 30 jours.`,
      date: yesterday,
    },
    {
      kind: "punctuality_streak",
      ...withMember(anas),
      text: `${anas.full_name} enchaîne 12 jours consécutifs à l'heure.`,
      date: yesterday,
    },
  ];
  return insights.slice(0, Math.max(0, limit));
}
