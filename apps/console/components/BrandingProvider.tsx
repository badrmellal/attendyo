"use client";

/**
 * BrandingProvider — loads branding tokens once, applies them to the document
 * (colors via CSS variables, lang/dir for the locale), and exposes them plus a
 * light/dark theme toggle to the rest of the app via context.
 *
 * This is the single place the white-label identity enters the UI. No component
 * should hard-code the product name — read it from `useBranding().branding`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Branding } from "@/lib/types";
import { getSettings } from "@/lib/api";
import { DEFAULT_BRANDING, applyBranding } from "@/lib/branding";
import { t as translate, decisionLabel, statusLabel } from "@/lib/i18n";

type Theme = "dark" | "light";

type BrandingContextValue = {
  branding: Branding;
  loading: boolean;
  theme: Theme;
  toggleTheme: () => void;
  setBranding: (b: Branding) => void;
  /** Translate a UI chrome key for the current locale. */
  t: (key: string) => string;
  decisionLabel: (decision: Parameters<typeof decisionLabel>[1]) => string;
  statusLabel: (status: Parameters<typeof statusLabel>[1]) => string;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

const THEME_KEY = "liwan.theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
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
        setBrandingState(s.branding);
        applyBranding(s.branding);
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
    setBrandingState(b);
    applyBranding(b);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      loading,
      theme,
      toggleTheme,
      setBranding,
      t: (key: string) => translate(branding.locale, key),
      decisionLabel: (d) => decisionLabel(branding.locale, d),
      statusLabel: (s) => statusLabel(branding.locale, s),
    }),
    [branding, loading, theme, toggleTheme, setBranding],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}
