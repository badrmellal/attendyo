"use client";

/**
 * Attendance — the morning-in / evening-out record per day.
 *  - Single date or a date range.
 *  - Table: member, department, first-in, last-out, hours, status pill.
 *  - CSV export. In live mode it navigates to /api/attendance/export.csv; in
 *    mock mode it builds and downloads the CSV client-side.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  Calendar,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { AttendancePill } from "@/components/StatusPill";
import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/Avatar";
import { useBranding } from "@/components/BrandingProvider";
import {
  attendanceExportUrl,
  attendanceToCSV,
  getAttendance,
  isMockForced,
} from "@/lib/api";
import type { AttendanceDay } from "@/lib/types";
import { cn, formatDuration, formatTime, shiftDate, todayISO } from "@/lib/utils";

type RangeMode = "day" | "range";

export default function AttendancePage() {
  const { branding } = useBranding();
  const [mode, setMode] = useState<RangeMode>("day");
  const [date, setDate] = useState(todayISO());
  const [from, setFrom] = useState(shiftDate(todayISO(), -6));
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<AttendanceDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = mode === "day" ? { date } : { from, to };
    getAttendance(params)
      .then((r) => active && setRows(r))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [mode, date, from, to]);

  const summary = useMemo(() => {
    const present = rows.filter((r) => r.status === "present").length;
    const late = rows.filter((r) => r.status === "late").length;
    const absent = rows.filter((r) => r.status === "absent").length;
    const incomplete = rows.filter((r) => r.status === "incomplete").length;
    return { present, late, absent, incomplete, total: rows.length };
  }, [rows]);

  function exportCsv() {
    const params = mode === "day" ? { date } : { from, to };
    if (isMockForced()) {
      // Build the CSV locally and trigger a download.
      const csv = attendanceToCSV(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance_${mode === "day" ? date : `${from}_${to}`}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Let the API stream the canonical export.
      window.open(attendanceExportUrl(params), "_blank");
    }
  }

  const columns: Column<AttendanceDay>[] = [
    {
      key: "member",
      header: "Personne",
      cell: (r) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.member_name} size={32} />
          <span className="font-medium text-text">{r.member_name}</span>
        </div>
      ),
    },
    {
      key: "department",
      header: "Département",
      cell: (r) => <span className="text-sm text-text-muted">{r.department || "—"}</span>,
    },
    ...(mode === "range"
      ? [
          {
            key: "date",
            header: "Date",
            cell: (r: AttendanceDay) => (
              <span className="tnum text-sm text-text-muted">{r.work_date}</span>
            ),
          } as Column<AttendanceDay>,
        ]
      : []),
    {
      key: "first_in",
      header: "Première entrée",
      cell: (r) =>
        r.first_in_ts ? (
          <span className="tnum inline-flex items-center gap-1.5 text-sm text-text">
            <ArrowDownLeft className="h-3.5 w-3.5 text-primary" />
            {formatTime(r.first_in_ts, branding.locale)}
          </span>
        ) : (
          <span className="text-sm text-text-muted">—</span>
        ),
    },
    {
      key: "last_out",
      header: "Dernière sortie",
      cell: (r) =>
        r.last_out_ts ? (
          <span className="tnum inline-flex items-center gap-1.5 text-sm text-text">
            <ArrowUpRight className="h-3.5 w-3.5 text-info" />
            {formatTime(r.last_out_ts, branding.locale)}
          </span>
        ) : (
          <span className="text-sm text-text-muted">—</span>
        ),
    },
    {
      key: "hours",
      header: "Heures",
      align: "right",
      cell: (r) => <span className="tnum text-sm text-text">{formatDuration(r.worked_seconds)}</span>,
    },
    {
      key: "status",
      header: "Statut",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end">
          <AttendancePill status={r.status} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">Présence</h2>
          <p className="text-sm text-text-muted">Entrées et sorties, par jour.</p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={loading || rows.length === 0}
          className="btn-ghost inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Exporter CSV
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
          <button
            type="button"
            onClick={() => setMode("day")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mode === "day" ? "bg-surface text-text shadow-sm" : "text-text-muted",
            )}
          >
            <Calendar className="h-4 w-4" /> Jour
          </button>
          <button
            type="button"
            onClick={() => setMode("range")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mode === "range" ? "bg-surface text-text shadow-sm" : "text-text-muted",
            )}
          >
            <CalendarRange className="h-4 w-4" /> Période
          </button>
        </div>

        {mode === "day" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDate((d) => shiftDate(d, -1))}
              className="btn-ghost flex h-9 w-9 items-center justify-center"
              aria-label="Jour précédent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="date"
                value={date}
                max={todayISO()}
                onChange={(e) => setDate(e.target.value)}
                className="field py-2 pl-10 pr-3 text-sm tnum"
              />
            </div>
            <button
              type="button"
              onClick={() => setDate((d) => (d < todayISO() ? shiftDate(d, 1) : d))}
              disabled={date >= todayISO()}
              className="btn-ghost flex h-9 w-9 items-center justify-center disabled:opacity-40"
              aria-label="Jour suivant"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="field py-2 px-3 text-sm tnum"
            />
            <span className="text-text-muted">→</span>
            <input
              type="date"
              value={to}
              min={from}
              max={todayISO()}
              onChange={(e) => setTo(e.target.value)}
              className="field py-2 px-3 text-sm tnum"
            />
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryChip label="Présents" value={summary.present} tone="primary" />
        <SummaryChip label="En retard" value={summary.late} tone="accent" />
        <SummaryChip label="Incomplets" value={summary.incomplete} tone="info" />
        <SummaryChip label="Absents" value={summary.absent} tone="danger" />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.member_id}-${r.work_date}-${i}`}
        loading={loading}
        empty={
          <EmptyState
            icon={CalendarDays}
            title="Aucune donnée de présence"
            description="Aucun enregistrement pour cette période."
          />
        }
      />
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "accent" | "info" | "danger";
}) {
  const cls = {
    primary: "text-primary",
    accent: "text-accent",
    info: "text-info",
    danger: "text-danger",
  }[tone];
  return (
    <div className="card-quiet flex items-center justify-between px-4 py-3">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn("tnum font-display text-xl font-semibold", cls)}>{value}</span>
    </div>
  );
}
