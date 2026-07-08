"use client";

/**
 * InsightsPanel — the "{product} IQ" card (`GET /api/insights`). Local
 * behavioural intelligence computed from the attendance history on the box —
 * pure SQL/stats, no cloud, no ML dependencies. The title is white-label:
 * "{branding.product_name} IQ", never a hard-coded brand.
 *
 * Kind → tone mapping (brand tokens): unusual_arrival = gold (accent),
 * absence_streak = rose (danger), punctuality_streak + record_presence =
 * ultramarine (primary).
 */

import { useEffect, useState } from "react";
import { CalendarX2, Flame, Sparkles, Sunrise, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { useBranding } from "./BrandingProvider";
import { getInsights } from "@/lib/api";
import type { Insight, InsightKind } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type Tone = "primary" | "accent" | "danger";

const KIND_META: Record<InsightKind, { icon: LucideIcon; tone: Tone }> = {
  unusual_arrival: { icon: Sunrise, tone: "accent" },
  absence_streak: { icon: CalendarX2, tone: "danger" },
  punctuality_streak: { icon: Flame, tone: "primary" },
  record_presence: { icon: Trophy, tone: "primary" },
};

const TONE_RING: Record<Tone, string> = {
  primary: "text-primary bg-primary/10 ring-primary/20",
  accent: "text-accent bg-accent/10 ring-accent/20",
  danger: "text-danger bg-danger/10 ring-danger/20",
};

/** Render the server-built line with the member name in bold. */
function InsightText({ insight }: { insight: Insight }) {
  const { text, member_name } = insight;
  if (!member_name) return <>{text}</>;
  const idx = text.indexOf(member_name);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-text">{member_name}</span>
      {text.slice(idx + member_name.length)}
    </>
  );
}

export function InsightsPanel({ className }: { className?: string }) {
  const { branding, t } = useBranding();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getInsights(8)
      .then((rows) => active && setInsights(rows))
      .catch(() => active && setInsights([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={cn("card p-5", className)}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-text">
            {branding.product_name} IQ
          </h3>
          <p className="text-xs text-text-muted">{t("iq.subtitle")}</p>
        </div>
        <Sparkles className="h-4 w-4 text-accent" />
      </div>

      {loading ? (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 px-3.5 py-3">
              <div className="skeleton h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-3.5 w-3/4" />
                <div className="skeleton h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : insights.length === 0 ? (
        <EmptyState icon={Sparkles} title={t("iq.empty")} className="py-8" />
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {insights.map((ins, i) => {
            const meta = KIND_META[ins.kind];
            const Icon = meta.icon;
            return (
              <li
                key={`${ins.kind}-${ins.member_id ?? "site"}-${ins.date}-${i}`}
                className="flex animate-fade-in items-start gap-3 rounded-xl border border-border/60 bg-surface-2/20 px-3.5 py-3"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1",
                    TONE_RING[meta.tone],
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-text">
                    <InsightText insight={ins} />
                  </p>
                  <p className="tnum mt-1 text-xs text-text-muted">
                    {formatDate(ins.date, branding.locale)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
