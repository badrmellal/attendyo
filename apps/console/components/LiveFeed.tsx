"use client";

/**
 * LiveFeed — subscribes to the SSE access stream and renders incoming decisions
 * as a calm, animated list. Granted = ultramarine, denied/unknown = red, the rest
 * gold. Each new row slides in. Used on the Dashboard (compact) and the Monitor
 * (full-bleed) pages.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Minus,
  ShieldX,
  UserCheck,
  UserX,
} from "lucide-react";
import { streamEvents } from "@/lib/api";
import type { AccessEvent } from "@/lib/types";
import { cn, formatTime, formatSimilarity, timeAgo } from "@/lib/utils";
import { useBranding } from "./BrandingProvider";

function decisionVisual(decision: AccessEvent["decision"]) {
  switch (decision) {
    case "granted":
      return { tone: "ok", Icon: UserCheck };
    case "unknown_face":
      return { tone: "danger", Icon: UserX };
    case "denied":
      return { tone: "danger", Icon: ShieldX };
    default:
      return { tone: "warn", Icon: ShieldX };
  }
}

const TONE_RING: Record<string, string> = {
  ok: "text-primary bg-primary/10 ring-primary/20",
  danger: "text-danger bg-danger/10 ring-danger/20",
  warn: "text-accent bg-accent/10 ring-accent/20",
};

function DirectionGlyph({ direction }: { direction: AccessEvent["direction"] }) {
  if (direction === "in") return <ArrowDownLeft className="h-3.5 w-3.5 text-primary" />;
  if (direction === "out") return <ArrowUpRight className="h-3.5 w-3.5 text-info" />;
  return <Minus className="h-3.5 w-3.5 text-text-muted" />;
}

export function LiveFeed({
  max = 20,
  variant = "panel",
  onLive,
}: {
  max?: number;
  variant?: "panel" | "bleed";
  onLive?: (live: boolean) => void;
}) {
  const { branding, decisionLabel, t } = useBranding();
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    const unsubscribe = streamEvents(
      (ev) => {
        setEvents((prev) => {
          if (seen.current.has(ev.id)) return prev;
          seen.current.add(ev.id);
          return [ev, ...prev].slice(0, max);
        });
      },
      { onStatus: (live) => onLive?.(live) },
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max]);

  return (
    <ul className={cn("space-y-2", variant === "bleed" && "space-y-2.5")}>
      {events.map((ev) => {
        const { tone, Icon } = decisionVisual(ev.decision);
        const granted = ev.decision === "granted";
        return (
          <li
            key={ev.id}
            className={cn(
              "flex animate-slide-in items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
              granted
                ? "border-primary/15 bg-primary/[0.04]"
                : tone === "danger"
                  ? "border-danger/15 bg-danger/[0.04]"
                  : "border-accent/15 bg-accent/[0.04]",
              variant === "bleed" && "px-4 py-3",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1",
                TONE_RING[tone],
              )}
            >
              <Icon className="h-4.5 w-4.5" size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-text">
                  {ev.member_name || t("feed.unknown")}
                </span>
                <DirectionGlyph direction={ev.direction} />
              </div>
              <p className="truncate text-xs text-text-muted">
                {ev.door_name}
                {ev.reason ? ` · ${ev.reason}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={cn(
                  "text-xs font-medium",
                  granted
                    ? "text-primary"
                    : tone === "danger"
                      ? "text-danger"
                      : "text-accent",
                )}
              >
                {decisionLabel(ev.decision)}
              </span>
              <span className="tnum text-[11px] text-text-muted">
                {formatTime(ev.ts, branding.locale)}
                {ev.similarity != null && granted ? ` · ${formatSimilarity(ev.similarity)}` : ""}
              </span>
            </div>
          </li>
        );
      })}
      {events.length === 0 && (
        <li className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/30 px-3 py-3 text-sm text-text-muted">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          {t("feed.listening")}
        </li>
      )}
    </ul>
  );
}

export { timeAgo };
