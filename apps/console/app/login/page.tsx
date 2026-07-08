"use client";

/**
 * Login — an elegant split screen. Left: branded narrative panel (the watchful
 * gate, the on-prem promise). Right: the sign-in form. Calls POST /api/auth/login
 * via the typed client; in mock mode it accepts admin@attendyo.local / attendyo-admin.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Mail, ShieldCheck, CircleAlert, Loader2 } from "lucide-react";
import { BrandMark } from "@/components/BrandLogo";
import { useBranding } from "@/components/BrandingProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { login, setToken, isMockForced } from "@/lib/api";

/** Demo credentials seeded for mock mode (CONTRACT default operator). */
const DEMO_EMAIL = "admin@attendyo.local";
const DEMO_PASSWORD = "attendyo-admin";

export default function LoginPage() {
  const router = useRouter();
  const { branding, t } = useBranding();
  const [email, setEmail] = useState(isMockForced() ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(isMockForced() ? DEMO_PASSWORD : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      setToken(res.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.failed"));
      setLoading(false);
    }
  }

  // Localized demo hint with the two credentials emphasized in the right spot
  // for any locale: interpolate placeholder tokens, then split around them.
  const demoParts = t("login.demoHint", { email: "%%E%%", password: "%%P%%" }).split(
    /%%E%%|%%P%%/,
  );

  return (
    <div className="app-aura min-h-screen lg:grid lg:grid-cols-2">
      {/* Brand narrative panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border p-12 lg:flex">
        {/* Photographic backdrop — bundled locally in /public, never hotlinked,
            so the app keeps zero external dependencies (the on-prem promise). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/login-bg.jpg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        {/* Brand wash: ties the photo into the palette and keeps text legible. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(150deg, rgb(var(--bg) / 0.88) 0%, rgb(var(--primary) / 0.42) 55%, rgb(var(--bg) / 0.97) 100%)",
          }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <BrandMark size={40} />
          <span className="font-display text-2xl font-semibold tracking-tight text-text">
            {branding.product_name}
          </span>
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="font-display text-[2.6rem] font-semibold leading-[1.05] tracking-tight text-text">
            {branding.tagline}
          </h2>
          <ul className="mt-8 space-y-4">
            {[t("login.point1"), t("login.point2"), t("login.point3")].map((line) => (
              <li key={line} className="flex items-start gap-3 text-text/85">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/25 text-primary ring-1 ring-primary/30">
                  <ShieldCheck className="h-3 w-3" />
                </span>
                <span className="text-sm">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-text-muted">{t("login.footer")}</p>
      </aside>

      {/* Form panel */}
      <main className="relative flex min-h-screen items-center justify-center p-6">
        <div className="absolute end-5 top-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark size={32} />
            <span className="font-display text-xl font-semibold text-text">
              {branding.product_name}
            </span>
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
            {t("login.welcome")}
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">{t("login.subtitle")}</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">
                {t("login.email")}
              </span>
              <div className="relative">
                <Mail className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field w-full py-2.5 ps-10 pe-3 text-sm"
                  placeholder={DEMO_EMAIL}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">
                {t("login.password")}
              </span>
              <div className="relative">
                <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field w-full py-2.5 ps-10 pe-3 text-sm"
                  placeholder="••••••••••"
                />
              </div>
            </label>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-sm text-danger animate-fade-in">
                <CircleAlert className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary group flex w-full items-center justify-center gap-2 py-2.5 text-sm"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {t("login.submit")}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {isMockForced() && (
            <p className="mt-6 rounded-lg border border-accent/20 bg-accent/[0.06] px-3 py-2.5 text-center text-xs text-text-muted">
              {demoParts[0]}
              <span className="font-medium text-text">{DEMO_EMAIL}</span>
              {demoParts[1]}
              <span className="font-medium text-text">{DEMO_PASSWORD}</span>
              {demoParts[2]}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
