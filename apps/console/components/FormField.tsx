"use client";

/**
 * FormField — the shared labelled-input wrapper used across every Console form
 * dialog. A muted label, an optional required asterisk, and the input(s) below.
 * Mirrors the look first established inside EnrollDialog so all forms match.
 */

import { cn } from "@/lib/utils";

export function FormField({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-text-muted">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-text-muted/80">{hint}</span>}
    </label>
  );
}

/** Inline form error banner, matching the EnrollDialog style. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

/** Pill-style segmented toggle used for enabled/direction-type small choices. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-primary/40 bg-primary/80" : "border-border bg-surface-2/60",
      )}
    >
      <span className="sr-only">{label ?? "Activer"}</span>
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-[#FBFAFF] shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-1",
        )}
      />
    </button>
  );
}
