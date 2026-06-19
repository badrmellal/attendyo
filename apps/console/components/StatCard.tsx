"use client";

/**
 * StatCard — a large tabular number with a label, an accent glyph, and an
 * optional trend/sub line. Subtle glow on the accent corner.
 */

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "primary" | "accent" | "danger" | "info" | "muted";

const TONE: Record<Tone, { text: string; glow: string; ring: string }> = {
  primary: { text: "text-primary", glow: "bg-primary/10", ring: "ring-primary/20" },
  accent: { text: "text-accent", glow: "bg-accent/10", ring: "ring-accent/20" },
  danger: { text: "text-danger", glow: "bg-danger/10", ring: "ring-danger/20" },
  info: { text: "text-info", glow: "bg-info/10", ring: "ring-info/20" },
  muted: { text: "text-text-muted", glow: "bg-surface-2", ring: "ring-border" },
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "muted",
  sub,
  loading,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: Tone;
  sub?: string;
  loading?: boolean;
}) {
  const c = TONE[tone];
  return (
    <div className="card group relative overflow-hidden p-5 transition-transform duration-200 ease-out-soft hover:-translate-y-0.5">
      {/* soft corner aura */}
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-60 transition-opacity duration-200 group-hover:opacity-100",
          c.glow,
        )}
        aria-hidden
      />
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-text-muted">{label}</span>
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg ring-1",
            c.glow,
            c.ring,
            c.text,
          )}
        >
          <Icon className="h-4.5 w-4.5" strokeWidth={2} size={18} />
        </span>
      </div>
      <div className="mt-4">
        {loading ? (
          <div className="skeleton h-9 w-20" />
        ) : (
          <span className={cn("tnum font-display text-4xl font-semibold leading-none", c.text)}>
            {value}
          </span>
        )}
      </div>
      {sub && <p className="mt-2 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}
