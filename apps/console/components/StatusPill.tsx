"use client";

/**
 * StatusPill — quiet status chips for decisions and attendance states.
 * Ultramarine / gold / red, hairline-bordered, calm. No loud fills.
 */

import { cn } from "@/lib/utils";
import { useBranding } from "./BrandingProvider";
import type { AccessDecision, AttendanceStatus } from "@/lib/types";

type Tone = "ok" | "warn" | "danger" | "info" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-primary bg-primary/10 border-primary/25",
  warn: "text-accent bg-accent/10 border-accent/25",
  danger: "text-danger bg-danger/10 border-danger/25",
  info: "text-info bg-info/10 border-info/25",
  muted: "text-text-muted bg-surface-2/60 border-border",
};

export function Pill({
  tone = "muted",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const DECISION_TONE: Record<AccessDecision, Tone> = {
  granted: "ok",
  denied: "danger",
  unknown_face: "danger",
  not_authorized: "warn",
  off_schedule: "warn",
};

export function DecisionPill({ decision }: { decision: AccessDecision }) {
  const { decisionLabel } = useBranding();
  return (
    <Pill tone={DECISION_TONE[decision]}>{decisionLabel(decision)}</Pill>
  );
}

const ATTENDANCE_TONE: Record<AttendanceStatus, Tone> = {
  present: "ok",
  late: "warn",
  absent: "danger",
  incomplete: "info",
};

export function AttendancePill({ status }: { status: AttendanceStatus }) {
  const { statusLabel } = useBranding();
  return <Pill tone={ATTENDANCE_TONE[status]}>{statusLabel(status)}</Pill>;
}
