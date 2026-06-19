"use client";

import { CheckCircle2, XCircle, Clock3, ShieldAlert } from "lucide-react";
import type { KioskResult, Locale } from "@/lib/types";
import {
  directionLabel,
  getStrings,
  localeTag,
  type Strings,
} from "@/lib/branding";
import { cn } from "@/lib/cn";

interface RecognitionOverlayProps {
  result: KioskResult;
  locale: Locale;
}

/** Pick the right localized reason line for a non-granted decision. */
function denialMessage(result: KioskResult, s: Strings): string {
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
 * ("Bienvenue {name}", title/department, check-in/out + time). Denied states
 * are a calm single red shake with a short reason — no alarm theatrics.
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
    const greeting = result.greeting?.trim() || s.welcome(name);
    const subtitle = [result.member?.title, result.member?.department]
      .filter(Boolean)
      .join(" · ");

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

        {subtitle && (
          <p
            className="animate-rise-in mt-3 text-[clamp(1rem,2.6vw,1.5rem)] font-medium text-text-muted"
            style={{ animationDelay: "60ms" }}
          >
            {subtitle}
          </p>
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

      {result.reason && (
        <p className="mt-3 text-[clamp(0.95rem,2.4vw,1.3rem)] font-medium text-text-muted">
          {result.reason}
        </p>
      )}
    </div>
  );
}
