/**
 * Shared types for Liwan Gate, mirrored from the system CONTRACT.md.
 * Keep these in lockstep with the contract — do not diverge silently.
 */

/** A recognition / access decision (CONTRACT.md → AccessEvent.decision). */
export type Decision =
  | "granted"
  | "denied"
  | "unknown_face"
  | "not_authorized"
  | "off_schedule";

/** Movement direction inferred for the event. */
export type Direction = "in" | "out" | "unknown";

/** Supported UI locales (CONTRACT.md → branding.locale). */
export type Locale = "fr" | "en" | "ar";

/** The minimal member subset the recognize endpoint returns. */
export interface RecognizedMember {
  id: string;
  full_name: string;
  department?: string;
  title?: string;
}

/**
 * Response of POST /api/recognize (CONTRACT.md → RecognizeResult).
 * The hot-path shape the kiosk renders.
 */
export interface RecognizeResult {
  decision: Decision;
  member?: RecognizedMember;
  similarity?: number;
  door_opened: boolean;
  /** Localized welcome line, computed server-side; the UI may also localize. */
  greeting?: string;
  direction: Direction;
  /**
   * Machine reason code for non-granted decisions (e.g. "expired",
   * "not_yet_valid" when the member's validity window does not cover today —
   * CONTRACT.md → Decision rules v2). Optional superset of the base contract.
   */
  reason?: string;
}

/**
 * A logged access decision (CONTRACT.md → AccessEvent). Emitted over the SSE
 * feed (`event: access`). The kiosk reacts to these so a person recognized by a
 * fixed RTSP camera on the same door (via the Bridge) still triggers the
 * door-open moment on the wall tablet.
 */
export interface AccessEvent {
  id: number;
  ts: string;
  member_id?: string;
  member_name?: string;
  subject_name?: string;
  similarity?: number;
  door_id?: string;
  door_name?: string;
  direction: Direction;
  decision: Decision;
  reason?: string;
  snapshot_url?: string;
}

/**
 * Branding block of GET /api/settings (CONTRACT.md → branding tokens).
 * Drives white-labeling — colors, wordmark, locale.
 */
export interface Branding {
  product_name: string;
  tagline?: string;
  primary_color: string;
  accent_color: string;
  logo_url?: string | null;
  locale: Locale;
}

/** Full settings payload (we only read branding here). */
export interface Settings {
  branding: Branding;
  // `attendance` exists in the contract but is irrelevant to the kiosk.
  [key: string]: unknown;
}

/**
 * A normalized result the overlay consumes. It always carries a resolved
 * direction and decision so the view layer never branches on `undefined`.
 */
export interface KioskResult {
  decision: Decision;
  direction: Direction;
  member?: RecognizedMember;
  similarity?: number;
  doorOpened: boolean;
  greeting?: string;
  /** Reason string for denied/unknown states, already localized when shown. */
  reason?: string;
  /** When the result was produced — used for the check-in/out timestamp line. */
  at: Date;
}
