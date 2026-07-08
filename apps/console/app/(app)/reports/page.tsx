"use client";

/**
 * Reports — presence analytics over a date range (`/api/reports/*`).
 *  - Presets: 7 jours / 30 jours / mois précédent / période personnalisée.
 *  - Summary stat cards (punctuality, daily averages, avg hours).
 *  - Daily present/late/absent stacked bar chart.
 *  - Per-department table and a sortable "top retards" members table.
 *  - CSV export (`?token=` URL in live mode, client-side CSV in mock).
 *  - "Imprimer" → the weekly report a director prints (see @media print).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  Clock,
  Download,
  Printer,
  Timer,
  TrendingUp,
  UserCheck,
  UserX,
  Building,
} from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { DailyStackedChart } from "@/components/DailyStackedChart";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/Avatar";
import { useBranding } from "@/components/BrandingProvider";
import {
  getReportsDepartments,
  getReportsMembers,
  getReportsSummary,
  isMockForced,
  memberReportToCSV,
  reportsExportUrl,
} from "@/lib/api";
import type { DepartmentReport, MemberReport, ReportSort, ReportsSummary } from "@/lib/types";
import { cn, formatDate, formatDuration, shiftDate, todayISO } from "@/lib/utils";

type Preset = "7d" | "30d" | "prev_month" | "custom";

const PRESETS: { value: Preset; labelKey: string }[] = [
  { value: "7d", labelKey: "reports.preset.7d" },
  { value: "30d", labelKey: "reports.preset.30d" },
  { value: "prev_month", labelKey: "reports.preset.prevMonth" },
  { value: "custom", labelKey: "common.custom" },
];

/** Local YYYY-MM-DD for an arbitrary Date. */
function localISO(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function prevMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: localISO(first), to: localISO(last) };
}

function rangeForPreset(preset: Preset): { from: string; to: string } {
  const today = todayISO();
  if (preset === "7d") return { from: shiftDate(today, -6), to: today };
  if (preset === "30d") return { from: shiftDate(today, -29), to: today };
  return prevMonthRange();
}

const SORTS: { value: ReportSort; labelKey: string }[] = [
  { value: "late", labelKey: "reports.sort.late" },
  { value: "absences", labelKey: "reports.sort.absences" },
  { value: "hours", labelKey: "reports.sort.hours" },
];

export default function ReportsPage() {
  const { branding, term, t } = useBranding();
  const [preset, setPreset] = useState<Preset>("7d");
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => ({
    from: shiftDate(todayISO(), -6),
    to: todayISO(),
  }));
  const [sort, setSort] = useState<ReportSort>("late");

  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [departments, setDepartments] = useState<DepartmentReport[]>([]);
  const [members, setMembers] = useState<MemberReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);

  const { from, to } = useMemo(
    () => (preset === "custom" ? custom : rangeForPreset(preset)),
    [preset, custom],
  );

  // Summary + departments follow the range; the members table also re-sorts.
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getReportsSummary(from, to), getReportsDepartments(from, to)])
      .then(([s, d]) => {
        if (!active) return;
        setSummary(s);
        setDepartments(d);
      })
      .catch(() => {
        if (!active) return;
        setSummary(null);
        setDepartments([]);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [from, to]);

  useEffect(() => {
    let active = true;
    setMembersLoading(true);
    getReportsMembers(from, to, sort, 15)
      .then((rows) => active && setMembers(rows))
      .catch(() => active && setMembers([]))
      .finally(() => active && setMembersLoading(false));
    return () => {
      active = false;
    };
  }, [from, to, sort]);

  const exportCsv = useCallback(async () => {
    if (isMockForced()) {
      // Full per-member aggregate, built client-side from the mock data.
      const rows = await getReportsMembers(from, to, "late", 500);
      const blob = new Blob([memberReportToCSV(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      window.open(reportsExportUrl(from, to), "_blank");
    }
  }, [from, to]);

  const punctuality = summary ? `${(summary.punctuality_rate * 100).toFixed(1)}%` : "—";

  const departmentColumns: Column<DepartmentReport>[] = [
    {
      key: "department",
      header: term.departmentLabel,
      cell: (r) => (
        <span className="inline-flex items-center gap-2 font-medium text-text">
          <Building className="h-3.5 w-3.5 text-text-muted" />
          {r.department}
        </span>
      ),
    },
    {
      key: "members",
      header: t("reports.col.headcount"),
      align: "right",
      cell: (r) => <span className="tnum text-sm text-text">{r.members}</span>,
    },
    {
      key: "present",
      header: t("reports.col.presentDays"),
      align: "right",
      cell: (r) => <span className="tnum text-sm text-primary">{r.present_days}</span>,
    },
    {
      key: "late",
      header: t("reports.col.late"),
      align: "right",
      cell: (r) => <span className="tnum text-sm text-accent">{r.late_days}</span>,
    },
    {
      key: "absent",
      header: t("reports.col.absences"),
      align: "right",
      cell: (r) => <span className="tnum text-sm text-danger">{r.absent_days}</span>,
    },
    {
      key: "hours",
      header: t("reports.col.avgHoursPerDay"),
      align: "right",
      cell: (r) => (
        <span className="tnum text-sm text-text">{formatDuration(r.avg_worked_seconds)}</span>
      ),
    },
  ];

  const memberColumns: Column<MemberReport>[] = [
    {
      key: "member",
      header: t("dash.col.person"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.member_name} size={32} />
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{r.member_name}</p>
            <p className="truncate text-xs text-text-muted">{r.department || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "present",
      header: t("stat.present"),
      align: "right",
      cell: (r) => <span className="tnum text-sm text-primary">{r.present_days}</span>,
    },
    {
      key: "late",
      header: t("reports.col.late"),
      align: "right",
      cell: (r) => (
        <span className={cn("tnum text-sm", sort === "late" ? "font-semibold text-accent" : "text-accent")}>
          {r.late_days}
        </span>
      ),
    },
    {
      key: "absent",
      header: t("reports.col.absences"),
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "tnum text-sm",
            sort === "absences" ? "font-semibold text-danger" : "text-danger",
          )}
        >
          {r.absent_days}
        </span>
      ),
    },
    {
      key: "arrival",
      header: t("reports.col.avgArrival"),
      align: "right",
      cell: (r) => <span className="tnum text-sm text-text-muted">{r.avg_arrival ?? "—"}</span>,
    },
    {
      key: "hours",
      header: t("reports.col.totalHours"),
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "tnum text-sm",
            sort === "hours" ? "font-semibold text-text" : "text-text",
          )}
        >
          {formatDuration(r.total_worked_seconds)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Print-only report header */}
      <div className="hidden print:block">
        <h1 className="font-display text-2xl font-semibold text-text">
          {t("reports.print.title", { product: branding.product_name })}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("reports.print.header", {
            from: formatDate(from, branding.locale),
            to: formatDate(to, branding.locale),
            today: formatDate(todayISO(), branding.locale),
          })}
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            {t("nav.reports")}
          </h2>
          <p className="text-sm text-text-muted">
            {t("reports.rangeGenerated", {
              from: formatDate(from, branding.locale),
              to: formatDate(to, branding.locale),
            })}
            {summary ? <> · {t("reports.subtitle.days", { n: summary.days })}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-ghost inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
          >
            <Printer className="h-4 w-4" />
            {t("common.print")}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading}
            className="btn-ghost inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {t("common.export")}
          </button>
        </div>
      </div>

      {/* Range controls */}
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                preset === p.value ? "bg-surface text-text shadow-sm" : "text-text-muted",
              )}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-text-muted" />
            <input
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || c.from }))}
              className="field tnum px-3 py-2 text-sm"
            />
            <span className="text-text-muted">→</span>
            <input
              type="date"
              value={custom.to}
              min={custom.from}
              max={todayISO()}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || c.to }))}
              className="field tnum px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label={t("reports.stat.punctuality")}
          value={punctuality}
          icon={TrendingUp}
          tone="primary"
          loading={loading}
          sub={t("reports.stat.punctuality.sub")}
        />
        <StatCard
          label={t("reports.stat.presentPerDay")}
          value={summary?.avg_present ?? 0}
          icon={UserCheck}
          tone="primary"
          loading={loading}
          sub={t("reports.stat.avgWorkdays")}
        />
        <StatCard
          label={t("reports.stat.latePerDay")}
          value={summary?.avg_late ?? 0}
          icon={Clock}
          tone="accent"
          loading={loading}
          sub={t("reports.stat.avgWorkdays")}
        />
        <StatCard
          label={t("reports.stat.absentPerDay")}
          value={summary?.avg_absent ?? 0}
          icon={UserX}
          tone="danger"
          loading={loading}
          sub={t("reports.stat.avgWorkdays")}
        />
        <StatCard
          label={t("reports.stat.hoursPerDay")}
          value={summary ? formatDuration(summary.avg_worked_seconds) : "—"}
          icon={Timer}
          tone="info"
          loading={loading}
          sub={t("reports.stat.avgPresence")}
        />
      </div>

      {/* Daily chart */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold text-text">{t("reports.daily.title")}</h3>
            <p className="text-xs text-text-muted">{t("reports.daily.sub")}</p>
          </div>
          <BarChart3 className="h-4 w-4 text-text-muted print:hidden" />
        </div>
        {loading ? (
          <div className="skeleton h-64 w-full" />
        ) : summary && summary.daily.length > 0 ? (
          <DailyStackedChart data={summary.daily} />
        ) : (
          <EmptyState
            icon={BarChart3}
            title={t("reports.empty.title")}
            description={t("reports.empty.chart")}
          />
        )}
      </div>

      {/* Departments */}
      <div>
        <h3 className="mb-3 font-display font-semibold text-text">
          {t("reports.byDepartment", { dept: term.departmentLabel.toLowerCase() })}
        </h3>
        <DataTable
          columns={departmentColumns}
          rows={departments}
          rowKey={(r) => r.department}
          loading={loading}
          skeletonRows={5}
          empty={
            <EmptyState
              icon={Building}
              title={t("reports.empty.title")}
              description={t("reports.empty.dept")}
            />
          }
        />
      </div>

      {/* Top retards / members */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display font-semibold text-text">
            {sort === "late"
              ? t("reports.top.late")
              : sort === "absences"
                ? t("reports.top.absences")
                : t("reports.top.hours")}
          </h3>
          <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1 print:hidden">
            {SORTS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSort(s.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  sort === s.value ? "bg-surface text-text shadow-sm" : "text-text-muted",
                )}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={memberColumns}
          rows={members}
          rowKey={(r) => r.member_id}
          loading={membersLoading}
          skeletonRows={6}
          empty={
            <EmptyState
              icon={Clock}
              title={t("reports.empty.title")}
              description={t("reports.empty.members")}
            />
          }
        />
      </div>
    </div>
  );
}
