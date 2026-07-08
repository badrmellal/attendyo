"use client";

import { CheckCircle2, XCircle, Clock3, ShieldAlert } from "lucide-react";
import type { KioskResult, Locale } from "@/lib/types";
import {
  directionLabel,
  getStrings,
  localeTag,
  resolveGreeting,
  type Strings,
} from "@/lib/branding";
import { cn } from "@/lib/cn";

interface RecognitionOverlayProps {
  result: KioskResult;
  locale: Locale;
}

/**
 * Machine reason codes the kiosk localizes itself (CONTRACT.md → Decision
 * rules v2). When one of these arrives it becomes the headline, and the raw
 * code is suppressed — a visitor never sees "expired" verbatim.
 */
const LOCALIZED_REASONS: ReadonlySet<string> = new Set([
  "expired",
  "not_yet_valid",
]);

/** Pick the right localized reason line for a non-granted decision. */
function denialMessage(result: KioskResult, s: Strings): string {
  // Validity-window denials carry a specific reason code — most actionable line.
  if (result.reason === "expired") return s.expired;
  if (result.reason === "not_yet_valid") return s.notYetValid;
  switch (result.decision) {
    case "unknown_face":
      return s.unknownFace;
    case "not_authorized":
      return s.notAuthorized;
    case "off_schedule":
      return s.offSchedule;
    case "denied":
    default:
      return s.denied;
  }
}

/**
 * The recognition result overlay. GRANTED is the signature celebratory state
 * ("Bienvenue {name}" on entry, "Au revoir {name}" + Sortie chip + day summary
 * on exit, plus the gold one-shot message card when an operator left a note).
 * Denied states are a calm single red shake with a short reason — no alarm
 * theatrics. `no_face` never reaches this component (silent non-event).
 *
 * All copy is localized via branding.locale; the container flips to RTL for ar.
 */
export function RecognitionOverlay({
  result,
  locale,
}: RecognitionOverlayProps) {
  const s = getStrings(locale);
  const granted = result.decision === "granted";
  const time = new Intl.DateTimeFormat(localeTag(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(result.at);

  if (granted) {
    const name = result.member?.full_name ?? "";
    // Server greeting verbatim; direction-aware fallback so an exit without a
    // server greeting (e.g. SSE AccessEvent) still says goodbye, not welcome.
    const greeting = resolveGreeting(result.greeting, result.direction, name, s);
    const subtitle = [result.member?.title, result.member?.department]
      .filter(Boolean)
      .join(" · ");
    // Exits carry day_summary; it takes the muted secondary slot (Smart Gate
    // rules): name line first, then the on-site total for today.
    const secondary = result.daySummary?.trim() || subtitle;

    return (
      <div className="animate-fade-in flex flex-col items-center text-center">
        <div
          className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            background: "var(--primary-glow)",
            boxShadow: "0 0 40px -6px rgb(var(--primary))",
          }}
        >
          <CheckCircle2
            className="h-11 w-11"
            style={{ color: "rgb(var(--primary))" }}
            strokeWidth={2}
          />
        </div>

        <h1 className="animate-rise-in font-display text-[clamp(2.4rem,6.5vw,4.5rem)] font-semibold leading-tight text-text">
          {greeting}
        </h1>

        {secondary && (
          <p
            className="animate-rise-in mt-3 text-[clamp(1rem,2.6vw,1.5rem)] font-medium text-text-muted"
            style={{ animationDelay: "60ms" }}
          >
            {secondary}
          </p>
        )}

        {/* One-shot door-side message: a distinct gold card (accent border +
            tint), text sized to be read at ~2m. The hold time is extended for
            message results so it can actually be read. */}
        {result.message && (
          <div
            className="animate-rise-in mt-6 w-full max-w-xl rounded-2xl border border-accent/40 bg-accent/10 px-7 py-5"
            style={{ animationDelay: "100ms" }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
              {s.messageLabel}
            </p>
            <p className="mt-1.5 text-[clamp(1.15rem,3.2vw,1.8rem)] font-medium leading-snug text-text">
              {result.message}
            </p>
          </div>
        )}

        <div
          className="animate-rise-in mt-8 flex items-center gap-4"
          style={{ animationDelay: "120ms" }}
        >
          <span
            className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[clamp(0.95rem,2vw,1.2rem)] font-semibold"
            style={{
              background: "var(--primary-glow)",
              color: "rgb(var(--primary))",
            }}
          >
            {directionLabel(result.direction, s)}
          </span>
          <span className="tabular text-[clamp(1.4rem,4vw,2.4rem)] font-semibold text-text">
            {time}
          </span>
        </div>

        <p
          className="animate-rise-in mt-5 text-sm font-medium uppercase tracking-[0.2em] text-text-muted"
          style={{ animationDelay: "160ms" }}
        >
          {result.doorOpened ? s.doorOpen : s.present}
        </p>
      </div>
    );
  }

  // Denied / unknown — calm single red shake.
  const Icon =
    result.decision === "off_schedule"
      ? Clock3
      : result.decision === "not_authorized"
        ? ShieldAlert
        : XCircle;

  return (
    <div
      className={cn(
        "animate-calm-shake flex flex-col items-center text-center",
      )}
    >
      <div
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
        style={{
          background: "rgb(var(--danger) / 0.12)",
          boxShadow: "0 0 40px -10px rgb(var(--danger))",
        }}
      >
        <Icon
          className="h-11 w-11"
          style={{ color: "rgb(var(--danger))" }}
          strokeWidth={2}
        />
      </div>

      <h1 className="font-display text-[clamp(1.9rem,5.5vw,3.4rem)] font-semibold leading-tight text-text">
        {denialMessage(result, s)}
      </h1>

      {result.reason && !LOCALIZED_REASONS.has(result.reason) && (
        <p className="mt-3 text-[clamp(0.95rem,2.4vw,1.3rem)] font-medium text-text-muted">
          {result.reason}
        </p>
      )}
    </div>
  );
}
