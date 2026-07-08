/**
 * Typed Attendyo API client (browser-side).
 *
 * Implements exactly the endpoints described in attendyo/CONTRACT.md. Every call
 * carries the bearer token when present. When `NEXT_PUBLIC_MOCK=1` — or when the
 * real API is unreachable — it transparently serves the rich offline dataset in
 * lib/mock.ts so the Console renders fully without a backend.
 */

import type {
  AccessEvent,
  AccessGroup,
  AccessGroupDraft,
  Alert,
  AlertQuery,
  AttendanceDay,
  AuditEntry,
  AuditQuery,
  AuthUser,
  Camera,
  CameraDraft,
  DepartmentReport,
  Door,
  DoorDraft,
  HealthStatus,
  ImportError,
  ImportResult,
  Insight,
  LoginResponse,
  Member,
  MemberDraft,
  MemberPatch,
  MemberQuery,
  MemberReport,
  MemberType,
  OperatorUser,
  PresenceNow,
  ReportSort,
  ReportsSummary,
  Settings,
  TodayStats,
  UserDraft,
  UserPatch,
} from "./types";
import {
  MOCK_EVENTS,
  mockAttendanceFor,
  ackAllMockAlerts,
  ackMockAlert,
  addMockAccessGroup,
  addMockCamera,
  addMockDoor,
  addMockMember,
  addMockUser,
  appendMockAudit,
  deleteMockAccessGroup,
  deleteMockCamera,
  deleteMockDoor,
  deleteMockMember,
  deleteMockUser,
  getMockAccessGroups,
  getMockAlertCount,
  getMockAlerts,
  getMockAudit,
  getMockCameras,
  getMockDoors,
  getMockMembers,
  getMockSettings,
  getMockUsers,
  mockId,
  mockInsights,
  mockPresenceNow,
  mockReportsDepartments,
  mockReportsMembers,
  mockReportsSummary,
  mockTodayStats,
  nextLiveEvent,
  putMockSettings,
  recordMockAlert,
  updateMockAccessGroup,
  updateMockCamera,
  updateMockDoor,
  updateMockMember,
  updateMockUser,
} from "./mock";
import { hoursDecimal, todayISO } from "./utils";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8088").replace(/\/$/, "");
const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
const TOKEN_KEY = "attendyo.token";

// --------------------------------------------------------------------------
// Token storage (client only)
// --------------------------------------------------------------------------
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function isMockForced() {
  return FORCE_MOCK;
}

/**
 * Build a usable `<img src>` for a member's enrollment photo.
 *
 * The API returns `photo_url` as a relative, auth-gated path
 * (`/api/members/{id}/photo`). A plain `<img>` can't send the bearer header, so
 * we make it absolute against the API host and pass the operator JWT as the
 * `?token=` query param (the same pattern the API accepts for CSV/SSE). Mock
 * photos are already blob: URLs and are returned untouched.
 */
export function memberPhotoSrc(photoUrl?: string | null): string | undefined {
  if (!photoUrl) return undefined;
  if (photoUrl.startsWith("blob:") || photoUrl.startsWith("data:")) return photoUrl;
  const base = photoUrl.startsWith("http") ? photoUrl : `${API_URL}${photoUrl}`;
  const token = getToken();
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Raised when the network/API is unreachable — triggers mock fallback. */
class UnreachableError extends Error {}

type FetchOpts = {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch {
    throw new UnreachableError(`Cannot reach ${path}`);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data?.detail || data?.message || message;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/**
 * Run a live request; on network failure (or when forced) run the mock.
 * Real API errors (4xx/5xx) are NOT masked — only unreachability falls back.
 */
async function withMock<T>(live: () => Promise<T>, mock: () => T | Promise<T>): Promise<T> {
  if (FORCE_MOCK) return mock();
  try {
    return await live();
  } catch (err) {
    if (err instanceof UnreachableError) return mock();
    throw err;
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------
export async function login(email: string, password: string): Promise<LoginResponse> {
  return withMock(
    () =>
      request<LoginResponse>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    async () => {
      await delay(350);
      if (email.trim().toLowerCase() === "admin@attendyo.local" && password === "attendyo-admin") {
        return { access_token: "mock.demo.token", token_type: "bearer" };
      }
      throw new ApiError(401, "Invalid credentials");
    },
  );
}

export async function me(): Promise<AuthUser> {
  return withMock(
    () => request<AuthUser>("/api/auth/me"),
    () => ({
      id: "00000000-0000-4000-8000-000000000000",
      email: "admin@attendyo.local",
      full_name: "Administrateur",
      role: "admin" as const,
    }),
  );
}

// --------------------------------------------------------------------------
// Members
// --------------------------------------------------------------------------
function filterMembers(members: Member[], query: MemberQuery): Member[] {
  let out = members;
  if (query.status) out = out.filter((m) => m.status === query.status);
  if (query.department) out = out.filter((m) => m.department === query.department);
  if (query.type) out = out.filter((m) => m.member_type === query.type);
  if (query.q) {
    const q = query.q.toLowerCase();
    out = out.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.external_id?.toLowerCase().includes(q) ||
        m.department?.toLowerCase().includes(q) ||
        m.title?.toLowerCase().includes(q),
    );
  }
  return out;
}

export async function listMembers(query: MemberQuery = {}): Promise<Member[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.department) params.set("department", query.department);
  if (query.type) params.set("type", query.type);
  const qs = params.toString();
  return withMock(
    () => request<Member[]>(`/api/members${qs ? `?${qs}` : ""}`),
    () => filterMembers(getMockMembers(), query),
  );
}

export async function getMember(id: string): Promise<Member> {
  return withMock(
    () => request<Member>(`/api/members/${id}`),
    () => {
      const m = getMockMembers().find((x) => x.id === id);
      if (!m) throw new ApiError(404, "Member not found");
      return m;
    },
  );
}

/**
 * Enroll a person from a single photo. `POST /api/members` (multipart).
 * One enrolled image is enough to be recognised at the gate.
 */
export async function enrollMember(draft: MemberDraft, image: Blob): Promise<Member> {
  return withMock(
    () => {
      const form = new FormData();
      Object.entries(draft).forEach(([k, v]) => {
        if (v != null && v !== "") form.append(k, String(v));
      });
      form.append("image", image, "enroll.jpg");
      return request<Member>("/api/members", { method: "POST", body: form });
    },
    async () => {
      await delay(700);
      const id = `00000000-${Math.floor(Math.random() * 9000 + 1000)}-4000-8000-${Date.now()
        .toString(16)
        .slice(-8)}0000`;
      const photoUrl =
        image instanceof Blob && typeof URL !== "undefined" && URL.createObjectURL
          ? URL.createObjectURL(image)
          : undefined;
      const member: Member = {
        id,
        external_id: draft.external_id,
        full_name: draft.full_name,
        subject_name: `subject_${id.slice(0, 8)}`,
        member_type: draft.member_type,
        department: draft.department,
        title: draft.title,
        email: draft.email,
        phone: draft.phone,
        access_group_id: draft.access_group_id,
        photo_url: photoUrl,
        valid_from: draft.valid_from,
        valid_until: draft.valid_until,
        status: "active",
        created_at: new Date().toISOString(),
      };
      return addMockMember(member);
    },
  );
}

export async function updateMember(id: string, patch: MemberPatch): Promise<Member> {
  return withMock(
    () =>
      request<Member>(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    async () => {
      await delay(350);
      try {
        // Explicit nulls clear the validity window in the mock store too.
        const normalized: Partial<Member> = {
          ...patch,
          valid_from: patch.valid_from ?? undefined,
          valid_until: patch.valid_until ?? undefined,
        };
        if (!("valid_from" in patch)) delete normalized.valid_from;
        if (!("valid_until" in patch)) delete normalized.valid_until;
        // Saving an empty door-side message clears it (contract: one-shot note).
        if (normalized.kiosk_message === "") normalized.kiosk_message = undefined;
        return updateMockMember(id, normalized);
      } catch {
        throw new ApiError(404, "Member not found");
      }
    },
  );
}

export async function deleteMember(id: string): Promise<void> {
  return withMock(
    () => request<void>(`/api/members/${id}`, { method: "DELETE" }),
    async () => {
      await delay(300);
      // Server-side this also removes the vision-engine subject; the UI just deletes.
      deleteMockMember(id);
    },
  );
}

// --------------------------------------------------------------------------
// Access groups — full CRUD (`/api/access-groups`).
// `door_ids` empty ⇒ all doors; `schedule` {} ⇒ any time.
// --------------------------------------------------------------------------
export async function listAccessGroups(): Promise<AccessGroup[]> {
  return withMock(
    () => request<AccessGroup[]>("/api/access-groups"),
    () => getMockAccessGroups(),
  );
}

export async function createAccessGroup(draft: AccessGroupDraft): Promise<AccessGroup> {
  return withMock(
    () =>
      request<AccessGroup>("/api/access-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }),
    async () => {
      await delay(400);
      const group = addMockAccessGroup(draft);
      appendMockAudit("access_group.create", "access_group", group.id, { name: group.name });
      return group;
    },
  );
}

export async function updateAccessGroup(
  id: string,
  patch: Partial<AccessGroupDraft>,
): Promise<AccessGroup> {
  return withMock(
    () =>
      request<AccessGroup>(`/api/access-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    async () => {
      await delay(350);
      try {
        const group = updateMockAccessGroup(id, patch);
        appendMockAudit("access_group.update", "access_group", id, {
          changed: Object.keys(patch),
        });
        return group;
      } catch {
        throw new ApiError(404, "Access group not found");
      }
    },
  );
}

export async function deleteAccessGroup(id: string): Promise<void> {
  return withMock(
    () => request<void>(`/api/access-groups/${id}`, { method: "DELETE" }),
    async () => {
      await delay(300);
      deleteMockAccessGroup(id);
      appendMockAudit("access_group.delete", "access_group", id);
    },
  );
}

// --------------------------------------------------------------------------
// Attendance
// --------------------------------------------------------------------------
export async function getAttendance(
  params: { date?: string; from?: string; to?: string; member_id?: string } = {},
): Promise<AttendanceDay[]> {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.member_id) qs.set("member_id", params.member_id);
  const query = qs.toString();
  return withMock(
    () => request<AttendanceDay[]>(`/api/attendance${query ? `?${query}` : ""}`),
    () => mockAttendanceFor(params),
  );
}

/**
 * Build the export.csv URL (the page can also just navigate to it). Direct
 * downloads can't carry an Authorization header, so the operator JWT rides as
 * the contract-blessed `?token=` query param.
 */
export function attendanceExportUrl(params: { date?: string; from?: string; to?: string }): string {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const token = getToken();
  if (token) qs.set("token", token);
  return `${API_URL}/api/attendance/export.csv${qs.toString() ? `?${qs.toString()}` : ""}`;
}

/** Produce a CSV string locally from rows — used for the mock download. */
export function attendanceToCSV(rows: AttendanceDay[]): string {
  const header = [
    "member_id",
    "member_name",
    "department",
    "work_date",
    "first_in",
    "last_out",
    "hours",
    "is_late",
    "status",
  ];
  const lines = rows.map((r) =>
    [
      r.member_id,
      r.member_name,
      r.department ?? "",
      r.work_date,
      r.first_in_ts ?? "",
      r.last_out_ts ?? "",
      hoursDecimal(r.worked_seconds),
      r.is_late ? "true" : "false",
      r.status,
    ]
      .map((cell) => {
        const s = String(cell);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------
export async function listEvents(
  params: { date?: string; decision?: string; door_id?: string; limit?: number } = {},
): Promise<AccessEvent[]> {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.decision) qs.set("decision", params.decision);
  if (params.door_id) qs.set("door_id", params.door_id);
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return withMock(
    () => request<AccessEvent[]>(`/api/events${query ? `?${query}` : ""}`),
    () => {
      let out = MOCK_EVENTS;
      if (params.decision) out = out.filter((e) => e.decision === params.decision);
      if (params.door_id) out = out.filter((e) => e.door_id === params.door_id);
      if (params.limit) out = out.slice(0, params.limit);
      return out;
    },
  );
}

type StreamOpts = {
  onStatus?: (live: boolean) => void;
  /** Fired for SSE `event: alert` frames (v2). */
  onAlert?: (alert: Alert) => void;
};

type MockStreamListener = {
  onEvent: (event: AccessEvent) => void;
  onAlert?: (alert: Alert) => void;
};

// Single shared mock ticker: every subscriber (dashboard feed, monitor wall,
// alert bell…) sees the SAME synthetic events, exactly like a real SSE fan-out.
// Non-granted events are also persisted as alerts so /alerts and the badge
// stay consistent with the stream.
const mockStreamListeners = new Set<MockStreamListener>();
let mockStreamTimer: ReturnType<typeof setInterval> | null = null;

function subscribeMockStream(listener: MockStreamListener): () => void {
  mockStreamListeners.add(listener);
  if (!mockStreamTimer) {
    mockStreamTimer = setInterval(() => {
      const event = nextLiveEvent();
      const alert = event.decision !== "granted" ? recordMockAlert(event) : null;
      mockStreamListeners.forEach((l) => {
        l.onEvent(event);
        if (alert) l.onAlert?.(alert);
      });
    }, 3200);
  }
  return () => {
    mockStreamListeners.delete(listener);
    if (mockStreamListeners.size === 0 && mockStreamTimer) {
      clearInterval(mockStreamTimer);
      mockStreamTimer = null;
    }
  };
}

/**
 * Subscribe to the live feed (`GET /api/events/stream`, SSE).
 *
 * The stream emits two NAMED event types: `access` (every decision) and
 * `alert` (v2 — persisted, acknowledgeable notifications). Returns an
 * unsubscribe function. When mock is active or the real stream is unreachable,
 * a shared synthetic ticker keeps every subscriber alive and consistent.
 */
export function streamEvents(
  onEvent: (event: AccessEvent) => void,
  opts: StreamOpts = {},
): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let unsubMock: (() => void) | null = null;

  const startMock = () => {
    opts.onStatus?.(false);
    unsubMock = subscribeMockStream({ onEvent, onAlert: opts.onAlert });
  };

  if (FORCE_MOCK || typeof EventSource === "undefined") {
    startMock();
  } else {
    try {
      // The browser EventSource can't set Authorization headers, so the API
      // accepts the JWT as the contract-blessed `?token=` query param.
      const token = getToken();
      const url = `${API_URL}/api/events/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
      source = new EventSource(url);
      source.addEventListener("access", (ev) => {
        try {
          onEvent(JSON.parse((ev as MessageEvent).data) as AccessEvent);
        } catch {
          /* ignore malformed frame */
        }
      });
      source.addEventListener("alert", (ev) => {
        try {
          opts.onAlert?.(JSON.parse((ev as MessageEvent).data) as Alert);
        } catch {
          /* ignore malformed frame */
        }
      });
      source.onopen = () => opts.onStatus?.(true);
      source.onerror = () => {
        // Real stream failed → fall back to the synthetic feed.
        if (source) {
          source.close();
          source = null;
        }
        if (!closed && !unsubMock) startMock();
      };
    } catch {
      startMock();
    }
  }

  return () => {
    closed = true;
    if (source) source.close();
    if (unsubMock) unsubMock();
  };
}

// --------------------------------------------------------------------------
// Dashboard
// --------------------------------------------------------------------------
export async function getTodayStats(): Promise<TodayStats> {
  return withMock(
    () => request<TodayStats>("/api/stats/today"),
    () => mockTodayStats(),
  );
}

// --------------------------------------------------------------------------
// Doors & cameras
// --------------------------------------------------------------------------
export async function listDoors(): Promise<Door[]> {
  return withMock(
    () => request<Door[]>("/api/doors"),
    () => getMockDoors(),
  );
}

export async function createDoor(draft: DoorDraft): Promise<Door> {
  return withMock(
    () =>
      request<Door>("/api/doors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }),
    async () => {
      await delay(400);
      const door: Door = {
        id: mockId(),
        ...draft,
        created_at: new Date().toISOString(),
      };
      return addMockDoor(door);
    },
  );
}

export async function updateDoor(id: string, patch: Partial<DoorDraft>): Promise<Door> {
  return withMock(
    () =>
      request<Door>(`/api/doors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    async () => {
      await delay(350);
      try {
        return updateMockDoor(id, patch);
      } catch {
        throw new ApiError(404, "Door not found");
      }
    },
  );
}

export async function deleteDoor(id: string): Promise<void> {
  return withMock(
    () => request<void>(`/api/doors/${id}`, { method: "DELETE" }),
    async () => {
      await delay(300);
      deleteMockDoor(id);
    },
  );
}

export async function listCameras(): Promise<Camera[]> {
  return withMock(
    () => request<Camera[]>("/api/cameras"),
    () => getMockCameras(),
  );
}

export async function createCamera(draft: CameraDraft): Promise<Camera> {
  return withMock(
    () =>
      request<Camera>("/api/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }),
    async () => {
      await delay(400);
      const camera: Camera = {
        id: mockId(),
        ...draft,
        created_at: new Date().toISOString(),
      };
      return addMockCamera(camera);
    },
  );
}

export async function updateCamera(id: string, patch: Partial<CameraDraft>): Promise<Camera> {
  return withMock(
    () =>
      request<Camera>(`/api/cameras/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    async () => {
      await delay(350);
      try {
        return updateMockCamera(id, patch);
      } catch {
        throw new ApiError(404, "Camera not found");
      }
    },
  );
}

export async function deleteCamera(id: string): Promise<void> {
  return withMock(
    () => request<void>(`/api/cameras/${id}`, { method: "DELETE" }),
    async () => {
      await delay(300);
      deleteMockCamera(id);
    },
  );
}

/** `POST /api/doors/{id}/open` — manual test pulse. */
export async function openDoor(id: string): Promise<{ ok: boolean }> {
  return withMock(
    () => request<{ ok: boolean }>(`/api/doors/${id}/open`, { method: "POST" }),
    async () => {
      await delay(500);
      return { ok: true };
    },
  );
}

// --------------------------------------------------------------------------
// Settings / branding
// --------------------------------------------------------------------------
export async function getSettings(): Promise<Settings> {
  return withMock(
    () => request<Settings>("/api/settings"),
    () => getMockSettings(),
  );
}

export async function putSettings(settings: Settings): Promise<Settings> {
  return withMock(
    () =>
      request<Settings>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }),
    async () => {
      await delay(400);
      return putMockSettings(settings);
    },
  );
}

// ==========================================================================
// v2 endpoints
// ==========================================================================

// --------------------------------------------------------------------------
// Reports & analytics (`/api/reports/*`, operator+)
// --------------------------------------------------------------------------
export async function getReportsSummary(from: string, to: string): Promise<ReportsSummary> {
  return withMock(
    () => request<ReportsSummary>(`/api/reports/summary?from=${from}&to=${to}`),
    () => mockReportsSummary(from, to),
  );
}

export async function getReportsDepartments(
  from: string,
  to: string,
): Promise<DepartmentReport[]> {
  return withMock(
    () => request<DepartmentReport[]>(`/api/reports/departments?from=${from}&to=${to}`),
    () => mockReportsDepartments(from, to),
  );
}

export async function getReportsMembers(
  from: string,
  to: string,
  sort: ReportSort = "late",
  limit = 15,
): Promise<MemberReport[]> {
  return withMock(
    () =>
      request<MemberReport[]>(
        `/api/reports/members?from=${from}&to=${to}&sort=${sort}&limit=${limit}`,
      ),
    () => mockReportsMembers(from, to, sort, limit),
  );
}

/**
 * `GET /api/reports/export.csv?from&to` — per-member aggregate CSV. Direct
 * downloads can't carry an Authorization header, so the operator JWT rides as
 * the contract-blessed `?token=` query param.
 */
export function reportsExportUrl(from: string, to: string): string {
  const qs = new URLSearchParams({ from, to });
  const token = getToken();
  if (token) qs.set("token", token);
  return `${API_URL}/api/reports/export.csv?${qs.toString()}`;
}

/** Build the per-member aggregate CSV locally — used for the mock download. */
export function memberReportToCSV(rows: MemberReport[]): string {
  const header = [
    "member_id",
    "member_name",
    "department",
    "present_days",
    "late_days",
    "absent_days",
    "avg_arrival",
    "total_hours",
  ];
  const lines = rows.map((r) =>
    [
      r.member_id,
      r.member_name,
      r.department ?? "",
      r.present_days,
      r.late_days,
      r.absent_days,
      r.avg_arrival ?? "",
      hoursDecimal(r.total_worked_seconds),
    ]
      .map((cell) => {
        const s = String(cell);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

// --------------------------------------------------------------------------
// Insights — "{product} IQ" (`GET /api/insights`, operator+). Deterministic,
// computed locally from attendance history; nothing stored, nothing cloud.
// --------------------------------------------------------------------------
export async function getInsights(limit = 10): Promise<Insight[]> {
  return withMock(
    () =>
      request<{ insights: Insight[] }>(`/api/insights?limit=${limit}`).then(
        (r) => r.insights,
      ),
    () => mockInsights(limit),
  );
}

// --------------------------------------------------------------------------
// Presence / muster (`GET /api/presence/now`, operator+)
// --------------------------------------------------------------------------
export async function getPresenceNow(): Promise<PresenceNow> {
  return withMock(
    () => request<PresenceNow>("/api/presence/now"),
    () => mockPresenceNow(),
  );
}

// --------------------------------------------------------------------------
// Alerts (`/api/alerts`, operator+ to ack)
// --------------------------------------------------------------------------
export async function listAlerts(query: AlertQuery = {}): Promise<Alert[]> {
  const qs = new URLSearchParams();
  if (query.acknowledged !== undefined) qs.set("acknowledged", String(query.acknowledged));
  if (query.kind) qs.set("kind", query.kind);
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return withMock(
    () => request<Alert[]>(`/api/alerts${q ? `?${q}` : ""}`),
    () => getMockAlerts(query),
  );
}

export async function getAlertCount(): Promise<{ unacknowledged: number }> {
  return withMock(
    () => request<{ unacknowledged: number }>("/api/alerts/count"),
    () => getMockAlertCount(),
  );
}

export async function ackAlert(id: number): Promise<Alert> {
  return withMock(
    () => request<Alert>(`/api/alerts/${id}/ack`, { method: "POST" }),
    async () => {
      await delay(250);
      try {
        return ackMockAlert(id);
      } catch {
        throw new ApiError(404, "Alert not found");
      }
    },
  );
}

export async function ackAllAlerts(): Promise<{ acknowledged: number }> {
  return withMock(
    () => request<{ acknowledged: number }>("/api/alerts/ack-all", { method: "POST" }),
    async () => {
      await delay(350);
      return ackAllMockAlerts();
    },
  );
}

/**
 * Cross-component "alerts changed" signal so the TopBar bell refreshes after an
 * ack anywhere in the app (and after live alert arrivals).
 */
export const ALERTS_CHANGED_EVENT = "attendyo:alerts-changed";

export function notifyAlertsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ALERTS_CHANGED_EVENT));
  }
}

// --------------------------------------------------------------------------
// Audit log (`GET /api/audit`, admin only)
// --------------------------------------------------------------------------
export async function listAudit(query: AuditQuery = {}): Promise<AuditEntry[]> {
  const qs = new URLSearchParams();
  if (query.limit) qs.set("limit", String(query.limit));
  if (query.action) qs.set("action", query.action);
  if (query.user) qs.set("user", query.user);
  const q = qs.toString();
  return withMock(
    () => request<AuditEntry[]>(`/api/audit${q ? `?${q}` : ""}`),
    () => getMockAudit(query),
  );
}

// --------------------------------------------------------------------------
// Team / operator users (`/api/users`, admin only)
// --------------------------------------------------------------------------
export async function listUsers(): Promise<OperatorUser[]> {
  return withMock(
    () => request<OperatorUser[]>("/api/users"),
    () => getMockUsers(),
  );
}

export async function createUser(draft: UserDraft): Promise<OperatorUser> {
  return withMock(
    () =>
      request<OperatorUser>("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }),
    async () => {
      await delay(400);
      try {
        return addMockUser(draft);
      } catch (err) {
        throw new ApiError(409, err instanceof Error ? err.message : "Conflit");
      }
    },
  );
}

export async function updateUser(id: string, patch: UserPatch): Promise<OperatorUser> {
  return withMock(
    () =>
      request<OperatorUser>(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    async () => {
      await delay(350);
      try {
        return updateMockUser(id, patch);
      } catch {
        throw new ApiError(404, "User not found");
      }
    },
  );
}

/** DELETE /api/users/{id} — the API refuses self-delete and last-admin (409). */
export async function deleteUser(id: string): Promise<void> {
  return withMock(
    () => request<void>(`/api/users/${id}`, { method: "DELETE" }),
    async () => {
      await delay(300);
      try {
        deleteMockUser(id);
      } catch (err) {
        throw new ApiError(409, err instanceof Error ? err.message : "Conflit");
      }
    },
  );
}

// --------------------------------------------------------------------------
// Bulk CSV import (`POST /api/members/import`, operator+)
// --------------------------------------------------------------------------

/** Canonical CSV header, straight from CONTRACT.md. */
export const IMPORT_CSV_COLUMNS = [
  "full_name",
  "external_id",
  "member_type",
  "department",
  "title",
  "email",
  "phone",
  "valid_from",
  "valid_until",
] as const;

const IMPORT_MEMBER_TYPES: MemberType[] = [
  "employee",
  "resident",
  "contractor",
  "visitor",
  "student",
  "faculty",
  "staff",
];

/** Minimal RFC-4180-ish line splitter (handles quoted cells + escaped quotes). */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mock-mode importer: parses the actual CSV file client-side and creates the
 * members (without photos — faces get enrolled later), mirroring the API's
 * behaviour: rows whose `external_id` already exists are skipped.
 */
async function importMembersMock(file: File): Promise<ImportResult> {
  const text = await file.text();
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { created: 0, skipped: 0, errors: [{ line: 1, message: "Fichier vide" }] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("full_name") === -1) {
    return {
      created: 0,
      skipped: 0,
      errors: [{ line: 1, message: "Colonne « full_name » manquante dans l'en-tête" }],
    };
  }

  const existingIds = new Set(
    getMockMembers()
      .map((m) => m.external_id)
      .filter(Boolean) as string[],
  );

  let created = 0;
  let skipped = 0;
  const errors: ImportError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = splitCsvLine(lines[i]);
    const get = (name: string) => {
      const idx = col(name);
      return idx >= 0 ? cells[idx] || undefined : undefined;
    };

    const fullName = get("full_name");
    if (!fullName) {
      errors.push({ line: lineNo, message: "full_name manquant" });
      continue;
    }

    const rawType = get("member_type") || "employee";
    if (!IMPORT_MEMBER_TYPES.includes(rawType as MemberType)) {
      errors.push({ line: lineNo, message: `member_type invalide: « ${rawType} »` });
      continue;
    }

    const validFrom = get("valid_from");
    const validUntil = get("valid_until");
    if (validFrom && !ISO_DATE.test(validFrom)) {
      errors.push({ line: lineNo, message: "valid_from doit être au format AAAA-MM-JJ" });
      continue;
    }
    if (validUntil && !ISO_DATE.test(validUntil)) {
      errors.push({ line: lineNo, message: "valid_until doit être au format AAAA-MM-JJ" });
      continue;
    }

    const externalId = get("external_id");
    if (externalId && existingIds.has(externalId)) {
      skipped++;
      continue;
    }

    const id = mockId();
    addMockMember({
      id,
      external_id: externalId,
      full_name: fullName,
      member_type: rawType as MemberType,
      department: get("department"),
      title: get("title"),
      email: get("email"),
      phone: get("phone"),
      valid_from: validFrom,
      valid_until: validUntil,
      status: "active",
      created_at: new Date().toISOString(),
    });
    if (externalId) existingIds.add(externalId);
    created++;
  }

  appendMockAudit("member.import", "member", undefined, {
    created,
    skipped,
    errors: errors.length,
  });
  return { created, skipped, errors };
}

/** `POST /api/members/import` (multipart `file`) — creates members WITHOUT photos. */
export async function importMembersCSV(file: File): Promise<ImportResult> {
  return withMock(
    () => {
      const form = new FormData();
      form.append("file", file, file.name || "import.csv");
      return request<ImportResult>("/api/members/import", { method: "POST", body: form });
    },
    async () => {
      await delay(600);
      return importMembersMock(file);
    },
  );
}

// --------------------------------------------------------------------------
// Health
// --------------------------------------------------------------------------
export async function getHealth(): Promise<HealthStatus> {
  return withMock(
    () => request<HealthStatus>("/health"),
    () => ({ status: "ok" as const, engine: "ok" as const, db: "ok" as const }),
  );
}

export { todayISO };
