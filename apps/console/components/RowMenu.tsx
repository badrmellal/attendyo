"use client";

/**
 * RowMenu — a quiet "⋯" action menu for table rows. Opens a hairline-bordered
 * popover of actions, closes on outside-click / Escape / selection. Destructive
 * items render in the danger tone. Used by the people table for per-row actions.
 */

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowAction = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

export function RowMenu({ actions, label = "Actions" }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2/60 hover:text-text",
          open && "bg-surface-2/60 text-text",
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 min-w-[11rem] animate-scale-in overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-pop"
        >
          {actions.map((action, i) => {
            const Icon = action.icon;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  action.tone === "danger"
                    ? "text-danger hover:bg-danger/10"
                    : "text-text hover:bg-surface-2/60",
                )}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" />}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
