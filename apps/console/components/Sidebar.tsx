"use client";

/**
 * Sidebar — the left rail. Grouped nav, active highlight with an ultramarine rail,
 * branded header, and a quiet footer note about the on-prem nature of the
 * product. Collapses to icons on mobile via a slide-over (handled by TopBar).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CalendarClock,
  MonitorPlay,
  DoorOpen,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { useBranding } from "./BrandingProvider";
import { cn } from "@/lib/utils";

type Item = { href: string; labelKey: string; icon: LucideIcon };
type Group = { titleKey: string; items: Item[] };

const GROUPS: Group[] = [
  {
    titleKey: "nav.section.overview",
    items: [{ href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard }],
  },
  {
    titleKey: "nav.section.access",
    items: [
      { href: "/people", labelKey: "nav.people", icon: Users },
      { href: "/attendance", labelKey: "nav.attendance", icon: CalendarClock },
      { href: "/monitor", labelKey: "nav.monitor", icon: MonitorPlay },
      { href: "/doors", labelKey: "nav.doors", icon: DoorOpen },
    ],
  },
  {
    titleKey: "nav.section.admin",
    items: [{ href: "/settings", labelKey: "nav.settings", icon: Settings }],
  },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useBranding();

  return (
    <nav className="flex h-full w-64 flex-col border-r border-border bg-surface/60 backdrop-blur-sm">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" onClick={onNavigate} aria-label="Home">
          <BrandLogo size={26} />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {GROUPS.map((group) => (
          <div key={group.titleKey} className="mb-5">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted/70">
              {t(group.titleKey)}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-text-muted hover:bg-surface-2/50 hover:text-text",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                      )}
                      <Icon
                        className={cn(
                          "h-4.5 w-4.5 shrink-0 transition-colors",
                          active ? "text-primary" : "text-text-muted group-hover:text-text",
                        )}
                        size={18}
                      />
                      {t(item.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2.5 rounded-lg bg-surface-2/40 px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          <div className="leading-tight">
            <p className="text-xs font-medium text-text">On-premise</p>
            <p className="text-[11px] text-text-muted">Runs on your LAN. No cloud.</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
