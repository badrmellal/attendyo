"use client";

/**
 * EmptyState — calm placeholder for empty tables/feeds and error states.
 */

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = "muted",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  tone?: "muted" | "danger";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center animate-fade-in",
        className,
      )}
    >
      <div
        className={cn(
          "mb-4 flex h-12 w-12 items-center justify-center rounded-xl border",
          tone === "danger"
            ? "border-danger/25 bg-danger/10 text-danger"
            : "border-border bg-surface-2/60 text-text-muted",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-display text-base font-semibold text-text">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
