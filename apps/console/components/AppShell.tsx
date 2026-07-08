"use client";

/**
 * AppShell — the authenticated layout: a fixed left rail, a sticky top bar, and
 * a scrolling content area. Guards the route by redirecting to /login when no
 * token is present (skipped in mock mode, which is always "signed in" for demos).
 * Provides a mobile slide-over for the sidebar.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useBranding } from "./BrandingProvider";
import { getToken, isMockForced } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Map a pathname to a localized page title via i18n keys. */
function titleKeyForPath(pathname: string): string {
  if (pathname.startsWith("/people")) return "nav.people";
  if (pathname.startsWith("/attendance")) return "nav.attendance";
  if (pathname.startsWith("/reports")) return "nav.reports";
  if (pathname.startsWith("/presence")) return "nav.presence";
  if (pathname.startsWith("/alerts")) return "nav.alerts";
  if (pathname.startsWith("/monitor")) return "nav.monitor";
  if (pathname.startsWith("/map")) return "nav.map";
  if (pathname.startsWith("/doors")) return "nav.doors";
  if (pathname.startsWith("/groups")) return "nav.groups";
  if (pathname.startsWith("/team")) return "nav.team";
  if (pathname.startsWith("/settings")) return "nav.settings";
  return "nav.dashboard";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, term } = useBranding();
  const [authed, setAuthed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth guard. In mock mode we treat the operator as always signed in.
  useEffect(() => {
    if (isMockForced() || getToken()) {
      setAuthed(true);
    } else {
      router.replace("/login");
    }
  }, [router]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  // People section is relabelled by the terminology preset (campus mode…).
  const title = pathname.startsWith("/people") ? term.peopleNav : t(titleKeyForPath(pathname));

  return (
    <div className="app-aura flex min-h-screen bg-bg print:bg-white">
      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-screen shrink-0 print:hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-0 h-full animate-slide-in">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} onOpenSidebar={() => setMobileOpen(true)} />
        <main className={cn("flex-1 px-4 py-6 print:px-0 print:py-0 md:px-8 md:py-8")}>
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
