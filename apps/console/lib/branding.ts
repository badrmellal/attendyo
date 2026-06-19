/**
 * Runtime branding (white-label).
 *
 * Branding tokens come from `GET /api/settings → branding`. This module applies
 * them to CSS custom properties at runtime so the whole UI recolors without a
 * rebuild, sets the document direction for the Arabic locale, and never relies
 * on a hard-coded product name. Defaults match brand/BRAND.md.
 */

import type { Branding, Locale } from "./types";
import { hexToRgbTriplet } from "./utils";

export const DEFAULT_BRANDING: Branding = {
  product_name: "Liwan",
  tagline: "The threshold that knows your people.",
  primary_color: "#5663F2",
  accent_color: "#E0A340",
  logo_url: null,
  locale: "fr",
};

/** Apply primary/accent colors to the root as RGB triplets (alpha-friendly). */
export function applyBrandingColors(branding: Branding, root?: HTMLElement) {
  const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;
  const primary = hexToRgbTriplet(branding.primary_color);
  const accent = hexToRgbTriplet(branding.accent_color);
  if (primary) el.style.setProperty("--primary", primary);
  if (accent) el.style.setProperty("--accent", accent);
}

/** RTL for Arabic; LTR otherwise. */
export function dirForLocale(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Apply document language + direction for the active locale. */
export function applyLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = dirForLocale(locale);
}

/** Apply colors + locale in one call. */
export function applyBranding(branding: Branding) {
  applyBrandingColors(branding);
  applyLocale(branding.locale);
}
