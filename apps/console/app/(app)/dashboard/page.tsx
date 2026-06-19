"use client";

/**
 * Dashboard — today at a glance.
 *  - Five stat cards: present, late, absent, on-site-now, denied.
 *  - Hourly entries bar chart.
 *  - Live access feed (SSE).
 *  - Latest granted entries table.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  UserCheck,
  Clock,
  UserX,
  Building2,
  ShieldAlert,
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Minus,
  Inbox,
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { HourlyChart } from "@/components/HourlyChart";
import { LiveFeed } from "@/components/LiveFeed";
import { DataTable, type Column } from "@/components/DataTable";
import { DecisionPill } from "@/components/StatusPill";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { useBranding } from "@/components/BrandingProvider";
import { getTodayStats, listEvents } from "@/lib/api";
import type { AccessEvent, TodayStats } from "@/lib/types";
import { formatTime, formatSimilarity } from "@/lib/utils";

function DirectionBadge({ direction }: { direction: AccessEvent["direction"] }) {
  const map = {
    in: { Icon: ArrowDownLeft, cls: "text-primary", label: "Entrée" },
    out: { Icon: ArrowUpRight, cls: "text-info", label: "Sortie" },
    unknown: { Icon: Minus, cls: "text-text-muted", label: "—" },
  } as const;
  const { Icon, cls, label } = map[direction];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

export default function DashboardPage() {
  const { branding, t } = useBranding();
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([getTodayStats(), listEvents({ decision: "granted", limit: 8 })])
      .then(([s, e]) => {
        if (!active) return;
        setStats(s);
        setEvents(e);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const columns: Column<AccessEvent>[] = [
    {
      key: "member",
      header: "Personne",
      cell: (e) => (
        <div className="flex items-center gap-3">
          <Avatar name={e.member_name || "Inconnu"} size={32} />
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{e.member_name || "—"}</p>
            <p className="truncate text-xs text-text-muted">{e.door_name}</p>
          </div>
        </div>
      ),
    },
    {
      key: "direction",
      header: "Sens",
      cell: (e) => <DirectionBadge direction={e.direction} />,
    },
    {
      key: "similarity",
      header: "Score",
      align: "right",
      cell: (e) => (
        <span className="tnum text-sm text-text-muted">{formatSimilarity(e.similarity)}</span>
      ),
    },
    {
      key: "time",
      header: "Heure",
      align: "right",
      cell: (e) => (
        <span className="tnum text-sm text-text-muted">{formatTime(e.ts, branding.locale)}</span>
      ),
    },
    {
      key: "decision",
      header: "Décision",
      align: "right",
      cell: (e) => (
        <div className="flex justify-end">
          <DecisionPill decision={e.decision} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-text-muted">{t("common.today")}</p>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-text">
            {new Intl.DateTimeFormat(branding.locale === "ar" ? "ar-MA" : branding.locale === "en" ? "en-GB" : "fr-MA", {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(new Date())}
          </h2>
        </div>
        {stats && (
          <p className="text-sm text-text-muted">
            <span className="tnum font-semibold text-text">{stats.total_members}</span> membres
            actifs
          </p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label={t("stat.present")}
          value={stats?.present ?? 0}
          icon={UserCheck}
          tone="primary"
          loading={loading}
          sub="Pointés ce matin"
        />
        <StatCard
          label={t("stat.late")}
          value={stats?.late ?? 0}
          icon={Clock}
          tone="accent"
          loading={loading}
          sub="Après l'heure de grâce"
        />
        <StatCard
          label={t("stat.absent")}
          value={stats?.absent ?? 0}
          icon={UserX}
          tone="danger"
          loading={loading}
          sub="Aucun pointage"
        />
        <StatCard
          label={t("stat.onsite")}
          value={stats?.on_site_now ?? 0}
          icon={Building2}
          tone="info"
          loading={loading}
          sub="Entrés, pas encore sortis"
        />
        <StatCard
          label={t("stat.denied")}
          value={stats?.denied_today ?? 0}
          icon={ShieldAlert}
          tone="muted"
          loading={loading}
          sub="Accès refusés"
        />
      </div>

      {/* Chart + live feed */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold text-text">Entrées par heure</h3>
              <p className="text-xs text-text-muted">Flux d'arrivées sur la journée</p>
            </div>
            <Activity className="h-4 w-4 text-text-muted" />
          </div>
          {loading ? (
            <div className="skeleton h-56 w-full" />
          ) : (
            <HourlyChart data={stats?.hourly ?? []} />
          )}
        </div>

        <div className="card flex flex-col p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold text-text">Flux en direct</h3>
              <p className="text-xs text-text-muted">Décisions d'accès en temps réel</p>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Live
            </span>
          </div>
          <div className="-mr-2 max-h-[280px] flex-1 overflow-y-auto pr-2">
            <LiveFeed max={12} />
          </div>
        </div>
      </div>

      {/* Latest entries */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display font-semibold text-text">Dernières entrées</h3>
          <Link href="/monitor" className="text-sm font-medium text-primary hover:underline">
            Voir la surveillance →
          </Link>
        </div>
        <DataTable
          columns={columns}
          rows={events}
          rowKey={(e) => String(e.id)}
          loading={loading}
          skeletonRows={6}
          empty={
            <EmptyState
              icon={Inbox}
              title="Aucune entrée pour l'instant"
              description="Les accès autorisés apparaîtront ici dès la première reconnaissance."
            />
          }
        />
      </div>
    </div>
  );
}
