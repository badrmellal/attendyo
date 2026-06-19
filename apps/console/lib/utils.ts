import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Locale } from "./types";

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Map a UI locale to a BCP-47 tag for Intl. */
const LOCALE_TAG: Record<Locale, string> = {
  fr: "fr-MA",
  en: "en-GB",
  ar: "ar-MA",
};

function tag(locale: Locale = "fr") {
  return LOCALE_TAG[locale] ?? "fr-MA";
}

/** Safe Date parse; returns null on bad input. */
export function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `14:32` — locale-aware clock time. */
export function formatTime(value?: string | null, locale: Locale = "fr"): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(tag(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** `19 Jun 2026` */
export function formatDate(value?: string | null, locale: Locale = "fr"): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(tag(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** `19 Jun, 14:32` — compact date + time for feeds. */
export function formatDateTime(value?: string | null, locale: Locale = "fr"): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(tag(locale), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** A short relative label like `2m ago` / `just now`. */
export function timeAgo(value?: string | null): string {
  const d = toDate(value);
  if (!d) return "—";
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Seconds → `8h 12m`. Used for worked-hours columns. */
export function formatDuration(seconds?: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Decimal hours, for CSV/summary — `8.2`. */
export function hoursDecimal(seconds?: number | null): string {
  if (seconds == null || seconds <= 0) return "0.0";
  return (seconds / 3600).toFixed(1);
}

/** `0.913` → `91.3%` for similarity scores. */
export function formatSimilarity(value?: number | null): string {
  if (value == null) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

/** Today as `YYYY-MM-DD` in local time. */
export function todayISO(): string {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

/** Shift an ISO date string (YYYY-MM-DD) by N days. */
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

/** First two initials of a name, for avatar fallbacks. */
export function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic hue from a string — gives each member a stable avatar tint. */
export function hueFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/** Title-case a snake/slug token: `unknown_face` → `Unknown Face`. */
export function humanize(value?: string): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convert a hex color (`#5663F2`) to an `R G B` triplet for CSS variables. */
export function hexToRgbTriplet(hex: string): string | null {
  const m = hex.trim().replace("#", "");
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}
