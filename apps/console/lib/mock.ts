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
  AttendanceDay,
  Branding,
  Camera,
  Door,
  Member,
  Settings,
  TodayStats,
} from "./types";
import { todayISO } from "./utils";

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
};

const SEED_PEOPLE: Seed[] = [
  { name: "Yasmine El Amrani", dept: "Direction", title: "Directrice Générale", type: "employee" },
  { name: "Omar Benjelloun", dept: "Sécurité", title: "Chef de Sécurité", type: "employee" },
  { name: "Salma Tazi", dept: "Ressources Humaines", title: "Responsable RH", type: "employee" },
  { name: "Karim Idrissi", dept: "Opérations", title: "Directeur des Opérations", type: "employee" },
  { name: "Nadia Bennani", dept: "Finance", title: "Contrôleuse de Gestion", type: "employee" },
  { name: "Youssef Alaoui", dept: "IT", title: "Administrateur Systèmes", type: "employee" },
  { name: "Hajar Chraibi", dept: "Finance", title: "Comptable", type: "employee" },
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
  { name: "ATLAS Maintenance", dept: "Prestataires", title: "Maintenance HVAC", type: "contractor" },
  { name: "Said Ouatar", dept: "Prestataires", title: "Nettoyage", type: "contractor" },
  { name: "Leila Hassani", dept: "Visiteurs", title: "Auditrice Externe", type: "visitor" },
  { name: "Marc Dubois", dept: "Visiteurs", title: "Consultant", type: "visitor", status: "archived" },
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
// Attendance for "today" — deterministic but lively.
// --------------------------------------------------------------------------
const WORKDAY = todayISO();

function makeAttendance(): AttendanceDay[] {
  return MOCK_MEMBERS.map((m, i) => {
    // Archived/suspended/visitors mostly absent; spread the rest.
    const inactive = m.status !== "active";
    const isVisitorOrContractor =
      m.member_type === "visitor" || m.member_type === "contractor";

    let status: AttendanceDay["status"];
    if (inactive) status = "absent";
    else if (i % 9 === 4) status = "absent";
    else if (i % 7 === 3) status = "late";
    else if (i % 11 === 6) status = "incomplete";
    else status = "present";

    if (isVisitorOrContractor && i % 2 === 0) status = "absent";

    if (status === "absent") {
      return {
        member_id: m.id,
        member_name: m.full_name,
        department: m.department,
        work_date: WORKDAY,
        is_late: false,
        status,
      };
    }

    const baseInMin = status === "late" ? 9 * 60 + 28 + (i % 20) : 8 * 60 + 35 + (i % 25);
    const inDate = new Date(`${WORKDAY}T00:00:00`);
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
      work_date: WORKDAY,
      first_in_ts: inDate.toISOString(),
      last_out_ts: hasOut ? outDate.toISOString() : undefined,
      worked_seconds: worked,
      is_late: status === "late",
      status,
    };
  });
}

export const MOCK_ATTENDANCE: AttendanceDay[] = makeAttendance();

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

  // On-site now: present/late/incomplete that have an in but no out yet.
  const onSiteNow = MOCK_ATTENDANCE.filter(
    (a) => a.first_in_ts && !a.last_out_ts && a.status !== "absent",
  ).length;

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
  product_name: "Liwan",
  tagline: "The threshold that knows your people.",
  primary_color: "#5663F2",
  accent_color: "#E0A340",
  logo_url: null,
  locale: "fr",
};

export const MOCK_SETTINGS: Settings = {
  branding: MOCK_BRANDING,
  attendance: {
    in_out_strategy: "first_in_last_out",
    min_revisit_seconds: 60,
    auto_open_on_grant: true,
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
// Access groups — minimal demo set so the member edit form's selector works.
// (schema.sql defines the table; the Console only needs id + name here.)
// --------------------------------------------------------------------------
export const MOCK_ACCESS_GROUPS: AccessGroup[] = [
  { id: uuid(301), name: "Accès complet", door_ids: [], created_at: iso(-1000 * 60 * 60 * 24 * 120) },
  {
    id: uuid(302),
    name: "Employés — Bureaux",
    door_ids: [MOCK_DOORS[0].id, MOCK_DOORS[1].id],
    created_at: iso(-1000 * 60 * 60 * 24 * 110),
  },
  {
    id: uuid(303),
    name: "Direction & Coffres",
    door_ids: [MOCK_DOORS[0].id, MOCK_DOORS[2].id],
    created_at: iso(-1000 * 60 * 60 * 24 * 90),
  },
  {
    id: uuid(304),
    name: "Prestataires — Heures ouvrées",
    door_ids: [MOCK_DOORS[0].id],
    created_at: iso(-1000 * 60 * 60 * 24 * 60),
  },
];

let liveAccessGroups: AccessGroup[] = [...MOCK_ACCESS_GROUPS];

export function getMockAccessGroups(): AccessGroup[] {
  return [...liveAccessGroups];
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
