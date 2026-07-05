/**
 * Liwan API client for the Gate kiosk.
 *
 * All calls are made browser-side against NEXT_PUBLIC_API_URL — the kiosk talks
 * to the on-prem Liwan API directly over the LAN. No cloud, no telemetry.
 *
 * Device endpoints (POST /api/recognize) authenticate with the shared
 * `X-Device-Key` header (CONTRACT.md → Base URL & auth).
 */
import { DEFAULT_BRANDING, normalizeLocale } from "./branding";
import type {
  AccessEvent,
  Branding,
  KioskResult,
  RecognizeResult,
  Settings,
} from "./types";

/** API base URL, normalized without a trailing slash. */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8088"
).replace(/\/+$/, "");

const DEVICE_KEY = process.env.NEXT_PUBLIC_DEVICE_KEY ?? "";

/** Runtime config for this terminal, resolved from ?query then env. */
export interface KioskConfig {
  cameraId?: string;
  doorId?: string;
  mock: boolean;
}

/**
 * Resolve the kiosk config. Query params win over env so a single image can be
 * deployed to many tablets, each addressed by `?camera=<uuid>&door=<uuid>`.
 */
export function resolveConfig(search?: URLSearchParams): KioskConfig {
  const q = search ?? new URLSearchParams();
  const cameraId =
    q.get("camera") ?? process.env.NEXT_PUBLIC_CAMERA_ID ?? undefined;
  const doorId = q.get("door") ?? process.env.NEXT_PUBLIC_DOOR_ID ?? undefined;
  const mockParam = q.get("mock");
  const mock =
    mockParam === "1" ||
    mockParam === "true" ||
    (mockParam === null && process.env.NEXT_PUBLIC_MOCK === "1");
  return {
    cameraId: cameraId || undefined,
    doorId: doorId || undefined,
    mock,
  };
}

/** Thrown on any non-2xx API response. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch branding. The kiosk needs no auth for its own rendering, but the
 * contract gates /api/settings behind a bearer token. We degrade gracefully:
 * on any failure we fall back to the brand defaults so the door never goes dark.
 */
export async function fetchBranding(signal?: AbortSignal): Promise<Branding> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Device terminals are unattended; keep the request cheap and uncached.
      cache: "no-store",
      signal,
    });
    if (!res.ok) return DEFAULT_BRANDING;
    const data = (await res.json()) as Partial<Settings>;
    const b = data.branding;
    if (!b) return DEFAULT_BRANDING;
    return {
      product_name: b.product_name ?? DEFAULT_BRANDING.product_name,
      tagline: b.tagline ?? DEFAULT_BRANDING.tagline,
      primary_color: b.primary_color ?? DEFAULT_BRANDING.primary_color,
      accent_color: b.accent_color ?? DEFAULT_BRANDING.accent_color,
      logo_url: b.logo_url ?? DEFAULT_BRANDING.logo_url,
      locale: normalizeLocale(b.locale),
    };
  } catch {
    // Offline / API booting / no token — defaults keep the terminal usable.
    return DEFAULT_BRANDING;
  }
}

/**
 * POST a captured frame to /api/recognize.
 *
 * @param image   JPEG/PNG blob captured from the webcam.
 * @param config  Resolved kiosk config (camera_id / door_id).
 * @param signal  Abort signal for timeout / unmount.
 * @returns the raw RecognizeResult from the API.
 */
export async function recognizeFrame(
  image: Blob,
  config: KioskConfig,
  signal?: AbortSignal,
): Promise<RecognizeResult> {
  const form = new FormData();
  // Contract field name is `image`.
  form.append("image", image, "frame.jpg");
  if (config.cameraId) form.append("camera_id", config.cameraId);
  if (config.doorId) form.append("door_id", config.doorId);

  const headers: HeadersInit = {};
  if (DEVICE_KEY) headers["X-Device-Key"] = DEVICE_KEY;

  const res = await fetch(`${API_BASE}/api/recognize`, {
    method: "POST",
    headers,
    body: form,
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as RecognizeResult;
}

/**
 * Convert a contract RecognizeResult into the normalized KioskResult the UI
 * renders. Reason text is left raw here; the view layer localizes by decision.
 */
export function toKioskResult(r: RecognizeResult): KioskResult {
  return {
    decision: r.decision,
    direction: r.direction ?? "unknown",
    member: r.member,
    similarity: r.similarity,
    doorOpened: Boolean(r.door_opened),
    greeting: r.greeting,
    reason: r.reason,
    at: new Date(),
  };
}

/**
 * Convert an SSE AccessEvent into a KioskResult so the same overlay can render
 * it. Used for events arriving from the Bridge / fixed cameras on this door.
 */
export function accessEventToKioskResult(e: AccessEvent): KioskResult {
  return {
    decision: e.decision,
    direction: e.direction ?? "unknown",
    member:
      e.member_id && e.member_name
        ? { id: e.member_id, full_name: e.member_name }
        : undefined,
    similarity: e.similarity,
    doorOpened: e.decision === "granted",
    reason: e.reason,
    at: e.ts ? new Date(e.ts) : new Date(),
  };
}

/**
 * Type guard for an SSE payload that looks like an AccessEvent.
 */
export function isAccessEvent(data: unknown): data is AccessEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as AccessEvent).decision === "string"
  );
}

/**
 * Subscribe to the live SSE access feed (GET /api/events/stream).
 *
 * The Gate primarily drives itself from its own recognize calls, but the stream
 * lets a kiosk also react to events from a fixed RTSP camera bound to the same
 * door (via the Bridge) — so a person recognized by the ceiling camera still
 * triggers the door-open moment on the wall tablet.
 *
 * Returns an unsubscribe function. Errors are non-fatal: EventSource reconnects
 * on its own, and the kiosk keeps capturing frames regardless.
 */
export function subscribeAccessStream(
  onEvent: (data: unknown) => void,
  onError?: (err: Event) => void,
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => {};
  }
  let source: EventSource | null = null;
  try {
    source = new EventSource(`${API_BASE}/api/events/stream`, {
      withCredentials: false,
    });
    source.addEventListener("access", (ev) => {
      try {
        onEvent(JSON.parse((ev as MessageEvent).data));
      } catch {
        // Ignore malformed frames; the stream stays open.
      }
    });
    if (onError) source.onerror = onError;
  } catch (err) {
    if (onError) onError(err as Event);
  }
  return () => {
    source?.close();
  };
}
