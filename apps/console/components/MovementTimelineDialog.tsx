"use client";

/**
 * MovementTimelineDialog — a member's "Parcours": the sequence of door crossings
 * for today, at zone granularity (camera → door → zone). Honest scope: this is
 * door-crossing tracking, not continuous camera-to-camera re-identification.
 *
 * Granted crossings only by default; the toggle adds denied attempts (`all=1`).
 * Empty state when the person hasn't moved today. Reuses the shared tokens.
 */

import { useEffect, useState } from "react";
import { Route, ArrowDown, ArrowUp, MapPin, Loader2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { Pill } from "./StatusPill";
import { Toggle } from "./FormField";
import { useBranding } from "./BrandingProvider";
import { getMemberTimeline, todayISO } from "@/lib/api";
import type { Member, TimelineStep } from "@/lib/types";
import { formatTime } from "@/lib/utils";

export function MovementTimelineDialog({
  open,
  member,
  onClose,
}: {
  open: boolean;
  member: Member | null;
  onClose: () => void;
}) {
  const { t, locale, directionLabel, decisionLabel } = useBranding();
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open || !member) return;
    let active = true;
    setLoading(true);
    getMemberTimeline(member.id, todayISO(), showAll)
      .then((r) => active && setSteps(r.steps))
      .catch(() => active && setSteps([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, member, showAll]);

  // Reset the denials toggle each time a different member's drawer opens.
  useEffect(() => {
    if (open) setShowAll(false);
  }, [open, member]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("timeline.title", { name: member?.full_name ?? "—" })}
      description={t("common.today")}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between">
          <label className="flex items-center gap-2.5 text-sm text-text">
            <Toggle checked={showAll} onChange={setShowAll} label={t("timeline.showAll")} />
            {t("timeline.showAll")}
          </label>
          <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : steps.length === 0 ? (
        <EmptyState
          icon={Route}
          title={t("timeline.empty.title")}
          description={t("timeline.empty.desc")}
        />
      ) : (
        <div>
          <p className="mb-4 text-xs text-text-muted">
            {t("timeline.steps", { n: steps.length })}
          </p>
          <ol className="relative space-y-1 ps-1">
            {/* the rail */}
            <span
              className="pointer-events-none absolute bottom-3 start-[7px] top-3 w-px bg-border"
              aria-hidden
            />
            {steps.map((step, i) => {
              const isIn = step.direction === "in";
              const granted = step.decision === "granted";
              return (
                <li key={i} className="relative flex items-start gap-3 py-1.5 ps-6">
                  <span
                    className={cnDot(granted)}
                    aria-hidden
                  />
                  <span className="tnum w-14 shrink-0 pt-0.5 text-sm font-medium text-text">
                    {formatTime(step.ts, locale)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">
                      {step.door_name ?? "—"}
                    </p>
                    {step.zone_name && (
                      <p className="flex items-center gap-1 truncate text-xs text-text-muted">
                        <MapPin className="h-3 w-3 shrink-0" /> {step.zone_name}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!granted && (
                      <Pill tone="danger" dot={false}>
                        {decisionLabel(step.decision)}
                      </Pill>
                    )}
                    <Pill tone={isIn ? "ok" : "muted"} dot={false}>
                      {isIn ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUp className="h-3 w-3" />
                      )}
                      {directionLabel(step.direction)}
                    </Pill>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Dialog>
  );
}

/** The timeline node — ultramarine for granted, rose for a denied crossing. */
function cnDot(granted: boolean): string {
  return [
    "absolute start-0 top-2.5 h-3.5 w-3.5 rounded-full border-2 border-surface",
    granted ? "bg-primary" : "bg-danger",
  ].join(" ");
}
