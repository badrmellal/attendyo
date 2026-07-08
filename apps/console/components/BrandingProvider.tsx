"use client";

/**
 * BrandingProvider — loads branding tokens once, applies them to the document
 * (colors via CSS variables, lang/dir for the locale), and exposes them plus a
 * light/dark theme toggle to the rest of the app via context.
 *
 * This is the single place the white-label identity enters the UI. No component
 * should hard-code the product name — read it from `useBranding().branding`.
 *
 * Settings apply everywhere, live (v3): every consumer reads `locale`,
 * `branding` (colors/product), and `term` (terminology) from this context, so a
 * settings save that calls `setBranding` (or `refresh`) repaints the whole
 * Console — locale, RTL, colors, terminology — with no reload.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Branding, Locale } from "@/lib/types";
import { getSettings } from "@/lib/api";
import { DEFAULT_BRANDING, applyBranding, dirForLocale } from "@/lib/branding";
import {
  t as translate,
  decisionLabel,
  statusLabel,
  memberStatusLabel,
  alertKindLabel,
  alertSeverityLabel,
  directionLabel,
} from "@/lib/i18n";
import { terminologyLabels, type TerminologyLabels } from "@/lib/terminology";

type Theme = "dark" | "light";

type BrandingContextValue = {
  branding: Branding;
  loading: boolean;
  /** The active locale — read this so a component never captures a stale one. */
  locale: Locale;
  /** Document direction for the active locale ("rtl" for Arabic). */
  dir: "rtl" | "ltr";
  theme: Theme;
  toggleTheme: () => void;
  setBranding: (b: Branding) => void;
  /** Re-fetch settings and repaint the app (colors + locale + terminology). */
  refresh: () => Promise<void>;
  /** Translate a UI chrome key for the current locale, with `{token}` params. */
  t: (key: string, params?: Record<string, string | number>) => string;
  decisionLabel: (decision: Parameters<typeof decisionLabel>[1]) => string;
  statusLabel: (status: Parameters<typeof statusLabel>[1]) => string;
  memberStatusLabel: (status: Parameters<typeof memberStatusLabel>[1]) => string;
  alertKindLabel: (kind: Parameters<typeof alertKindLabel>[1]) => string;
  alertSeverityLabel: (severity: Parameters<typeof alertSeverityLabel>[1]) => string;
  directionLabel: (direction: Parameters<typeof directionLabel>[1]) => string;
  /** Vertical-specific labels ("workforce" | "campus" | "residence"). */
  term: TerminologyLabels;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

const THEME_KEY = "attendyo.theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

/** Older backends may not send the v2 terminology preset yet — normalize it. */
function normalizeBranding(b: Branding): Branding {
  return { ...b, terminology: b.terminology ?? "workforce" };
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBrandingState] = useState<Branding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<Theme>("dark");

  // Initial theme from storage (client only).
  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  // Apply theme to <html> and persist.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Load branding tokens once and apply.
  useEffect(() => {
    let active = true;
    getSettings()
      .then((s) => {
        if (!active) return;
        const next = normalizeBranding(s.branding);
        setBrandingState(next);
        applyBranding(next);
      })
      .catch(() => {
        if (!active) return;
        applyBranding(DEFAULT_BRANDING);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const setBranding = useCallback((b: Branding) => {
    const next = normalizeBranding(b);
    setBrandingState(next);
    applyBranding(next);
  }, []);

  // Re-pull settings and repaint. Called after PUT /api/settings so the admin
  // sees locale/colors/terminology changes instantly, without a reload. Works
  // in mock mode too (the mock keeps the mutated settings in memory).
  const refresh = useCallback(async () => {
    const s = await getSettings();
    const next = normalizeBranding(s.branding);
    setBrandingState(next);
    applyBranding(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      loading,
      locale: branding.locale,
      dir: dirForLocale(branding.locale),
      theme,
      toggleTheme,
      setBranding,
      refresh,
      t: (key, params) => translate(branding.locale, key, params),
      decisionLabel: (d) => decisionLabel(branding.locale, d),
      statusLabel: (s) => statusLabel(branding.locale, s),
      memberStatusLabel: (s) => memberStatusLabel(branding.locale, s),
      alertKindLabel: (k) => alertKindLabel(branding.locale, k),
      alertSeverityLabel: (s) => alertSeverityLabel(branding.locale, s),
      directionLabel: (dr) => directionLabel(branding.locale, dr),
      term: terminologyLabels(branding.terminology),
    }),
    [branding, loading, theme, toggleTheme, setBranding, refresh],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}
