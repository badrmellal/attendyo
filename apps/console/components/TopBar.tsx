"use client";

/**
 * TopBar — page title, a live health pill, theme toggle, the demo-mode badge
 * when mock data is active, and the operator menu (sign out). On mobile it also
 * carries the hamburger that opens the Sidebar slide-over.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, LogOut, ChevronDown, Wifi, WifiOff, FlaskConical, Bell } from "lucide-react";
import { useBranding } from "./BrandingProvider";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./Avatar";
import {
  ALERTS_CHANGED_EVENT,
  getAlertCount,
  getHealth,
  isMockForced,
  me,
  setToken,
  streamEvents,
} from "@/lib/api";
import type { AuthUser, HealthStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TopBar({ title, onOpenSidebar }: { title: string; onOpenSidebar?: () => void }) {
  const router = useRouter();
  const { t } = useBranding();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [unackAlerts, setUnackAlerts] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getHealth()
      .then((h) => active && setHealth(h))
      .catch(() => active && setHealth(null));
    me()
      .then((u) => active && setUser(u))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Alert badge: initial count, refreshed on live `alert` SSE frames and on
  // the app-wide "alerts changed" signal fired after any acknowledgement.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      getAlertCount()
        .then((c) => active && setUnackAlerts(c.unacknowledged))
        .catch(() => {});
    };
    refresh();
    const unsub = streamEvents(() => {}, { onAlert: refresh });
    window.addEventListener(ALERTS_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      unsub();
      window.removeEventListener(ALERTS_CHANGED_EVENT, refresh);
    };
  }, []);

  // Close the operator menu on outside click.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  function signOut() {
    setToken(null);
    router.push("/login");
  }

  const healthy = health?.status === "ok" && health.engine === "ok" && health.db === "ok";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md print:hidden md:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted hover:text-text md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h1 className="font-display text-lg font-semibold tracking-tight text-text">{title}</h1>

      <div className="ml-auto flex items-center gap-2.5">
        {isMockForced() && (
          <span className="hidden items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent sm:inline-flex">
            <FlaskConical className="h-3.5 w-3.5" />
            {t("common.demoData")}
          </span>
        )}

        {/* Health pill */}
        <span
          className={cn(
            "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex",
            healthy
              ? "border-primary/25 bg-primary/10 text-primary"
              : "border-danger/25 bg-danger/10 text-danger",
          )}
          title={
            health
              ? t("health.tip", { engine: health.engine, db: health.db })
              : t("health.unreachable")
          }
        >
          {healthy ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {healthy ? t("health.online") : t("health.offline")}
        </span>

        {/* Alerts bell — unacknowledged count, links to /alerts */}
        <Link
          href="/alerts"
          aria-label={
            unackAlerts > 0
              ? `${t("nav.alerts")} — ${t("alerts.subtitle.some", { n: unackAlerts })}`
              : t("nav.alerts")
          }
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-text-muted/40 hover:text-text"
        >
          <Bell className="h-4.5 w-4.5" size={18} />
          {unackAlerts > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-[#FBFAFF]">
              {unackAlerts > 99 ? "99+" : unackAlerts}
            </span>
          )}
        </Link>

        <ThemeToggle />

        {/* Operator menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 py-1 pl-1 pr-2 transition-colors hover:border-text-muted/40"
          >
            <Avatar name={user?.full_name || user?.email || t("topbar.operator")} size={28} />
            <span className="hidden max-w-[120px] truncate text-sm font-medium text-text sm:block">
              {user?.full_name || user?.email || t("topbar.operator")}
            </span>
            <ChevronDown className="h-4 w-4 text-text-muted" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-52 origin-top-right animate-scale-in rounded-xl border border-border bg-surface p-1.5 shadow-pop">
              <div className="px-3 py-2">
                <p className="truncate text-sm font-medium text-text">
                  {user?.full_name || t("topbar.operator")}
                </p>
                <p className="truncate text-xs text-text-muted">{user?.email}</p>
              </div>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-2/60 hover:text-danger"
              >
                <LogOut className="h-4 w-4" />
                {t("common.signout")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
