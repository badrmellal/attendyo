/**
 * Typed Liwan API client (browser-side).
 *
 * Implements exactly the endpoints described in liwan/CONTRACT.md. Every call
 * carries the bearer token when present. When `NEXT_PUBLIC_MOCK=1` — or when the
 * real API is unreachable — it transparently serves the rich offline dataset in
 * lib/mock.ts so the Console renders fully without a backend.
 */

import type {
  AccessEvent,
  AttendanceDay,
  AuthUser,
  Camera,
  Door,
  HealthStatus,
  LoginResponse,
  Member,
  MemberDraft,
  MemberQuery,
  Settings,
  TodayStats,
} from "./types";
import {
  MOCK_ATTENDANCE,
  MOCK_CAMERAS,
  MOCK_DOORS,
  MOCK_EVENTS,
  addMockMember,
  getMockMembers,
  getMockSettings,
  mockTodayStats,
  nextLiveEvent,
  putMockSettings,
} from "./mock";
import { hoursDecimal, todayISO } from "./utils";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8088").replace(/\/$/, "");
const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
const TOKEN_KEY = "liwan.token";

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
      if (email.trim().toLowerCase() === "admin@liwan.local" && password === "liwan-admin") {
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
      email: "admin@liwan.local",
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
        status: "active",
        created_at: new Date().toISOString(),
      };
      return addMockMember(member);
    },
  );
}

export async function updateMember(id: string, patch: Partial<Member>): Promise<Member> {
  return withMock(
    () =>
      request<Member>(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    () => {
      const m = getMockMembers().find((x) => x.id === id);
      if (!m) throw new ApiError(404, "Member not found");
      return { ...m, ...patch };
    },
  );
}

export async function deleteMember(id: string): Promise<void> {
  return withMock(
    () => request<void>(`/api/members/${id}`, { method: "DELETE" }),
    async () => undefined,
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
    () => MOCK_ATTENDANCE,
  );
}

/** Build the export.csv URL (the page can also just navigate to it). */
export function attendanceExportUrl(params: { date?: string; from?: string; to?: string }): string {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
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

/**
 * Subscribe to the live access feed (`GET /api/events/stream`, SSE).
 *
 * Returns an unsubscribe function. When mock is active or the real stream is
 * unreachable, it emits synthetic events on an interval so the UI stays alive.
 */
export function streamEvents(
  onEvent: (event: AccessEvent) => void,
  opts: { onStatus?: (live: boolean) => void } = {},
): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const startMock = () => {
    opts.onStatus?.(false);
    timer = setInterval(() => {
      if (!closed) onEvent(nextLiveEvent());
    }, 3200);
  };

  if (FORCE_MOCK || typeof EventSource === "undefined") {
    startMock();
  } else {
    try {
      // The browser EventSource can't set Authorization headers, so the API is
      // expected to accept the token as a query param on the stream endpoint.
      const token = getToken();
      const url = `${API_URL}/api/events/stream${token ? `?access_token=${encodeURIComponent(token)}` : ""}`;
      source = new EventSource(url);
      source.addEventListener("access", (ev) => {
        try {
          onEvent(JSON.parse((ev as MessageEvent).data) as AccessEvent);
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
        if (!closed && !timer) startMock();
      };
    } catch {
      startMock();
    }
  }

  return () => {
    closed = true;
    if (source) source.close();
    if (timer) clearInterval(timer);
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
    () => MOCK_DOORS,
  );
}

export async function listCameras(): Promise<Camera[]> {
  return withMock(
    () => request<Camera[]>("/api/cameras"),
    () => MOCK_CAMERAS,
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

// --------------------------------------------------------------------------
// Health
// --------------------------------------------------------------------------
export async function getHealth(): Promise<HealthStatus> {
  return withMock(
    () => request<HealthStatus>("/health"),
    () => ({ status: "ok", compreface: "ok", db: "ok" }),
  );
}

export { todayISO };
