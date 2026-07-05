"use client";

/**
 * Presence — who is on site right now (`GET /api/presence/now`).
 *  - Big live count + searchable list (name, dept, type, first-in, door).
 *  - Auto-refresh every 30 s AND on every SSE `access` event.
 *  - "Liste d'évacuation" print: a muster list with a tick-box column and a
 *    date/time header the safety officer reads at the assembly point.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, Building2, DoorOpen, Printer, RefreshCw, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/Avatar";
import { useBranding } from "@/components/BrandingProvider";
import { getPresenceNow, streamEvents } from "@/lib/api";
import type { PresenceNow, PresencePerson } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

const REFRESH_MS = 30_000;

export default function PresencePage() {
  const { branding, term } = useBranding();
  const [presence, setPresence] = useState<PresenceNow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // Serialize refreshes: SSE bursts + the 30s timer must not overlap requests.
  const inFlight = useRef(false);

  const refresh = useCallback(async (initial = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!initial) setRefreshing(true);
    try {
      const p = await getPresenceNow();
      setPresence(p);
      setUpdatedAt(new Date());
    } catch {
      /* keep the last known list — presence must degrade gracefully */
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(), REFRESH_MS);
    // Every access decision can change who's on site — refetch on the stream.
    const unsub = streamEvents(() => refresh());
    return () => {
      clearInterval(timer);
      unsub();
    };
  }, [refresh]);

  const people = presence?.people ?? [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? people.filter((p) =>
        [p.member_name, p.department, term.memberTypeLabels[p.member_type]]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : people;

  const columns: Column<PresencePerson>[] = [
    {
      // Print-only tick boxes — the muster list is checked with a pen.
      key: "check",
      header: <span className="hidden print:inline">Pointé</span>,
      className: "hidden print:table-cell w-14",
      headerClassName: "hidden print:table-cell w-14",
      cell: () => <span className="print-checkbox" aria-hidden />,
    },
    {
      key: "member",
      header: "Personne",
      cell: (p) => (
        <div className="flex items-center gap-3">
          <span className="print:hidden">
            <Avatar name={p.member_name} size={32} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{p.member_name}</p>
            <p className="truncate text-xs text-text-muted">{p.department || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (p) => (
        <span className="text-sm text-text-muted">{term.memberTypeLabels[p.member_type]}</span>
      ),
    },
    {
      key: "first_in",
      header: "Entré à",
      cell: (p) => (
        <span className="tnum inline-flex items-center gap-1.5 text-sm text-text">
          <ArrowDownLeft className="h-3.5 w-3.5 text-primary print:hidden" />
          {formatTime(p.first_in_ts, branding.locale)}
        </span>
      ),
    },
    {
      key: "door",
      header: "Porte",
      cell: (p) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-text-muted">
          <DoorOpen className="h-3.5 w-3.5 print:hidden" />
          {p.first_in_door_name || "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Print-only muster header */}
      <div className="hidden print:block">
        <h1 className="font-display text-2xl font-semibold text-text">
          {branding.product_name} — Liste d&apos;évacuation
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Éditée le{" "}
          {new Intl.DateTimeFormat("fr-MA", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date())}{" "}
          · <span className="tnum font-semibold">{people.length}</span> personne(s) sur site.
          Cochez chaque personne présente au point de rassemblement.
        </p>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <Building2 className="h-7 w-7" />
          </span>
          <div>
            <p className="text-sm text-text-muted">Sur site actuellement</p>
            {loading ? (
              <div className="skeleton mt-1 h-9 w-16" />
            ) : (
              <p className="tnum font-display text-4xl font-semibold leading-none text-text">
                {presence?.count ?? 0}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {updatedAt
              ? `Actualisé à ${formatTime(updatedAt.toISOString(), branding.locale)} · auto 30 s`
              : "Actualisation auto toutes les 30 s"}
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading}
            className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            Liste d&apos;évacuation
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative print:hidden">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Rechercher par nom, ${term.departmentLabel.toLowerCase()}, type…`}
          className="field w-full py-2 pl-10 pr-3 text-sm"
        />
        {q && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
            <span className="tnum font-medium text-text">{filtered.length}</span> résultat(s)
          </span>
        )}
      </div>

      {/* List */}
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.member_id}
        loading={loading}
        skeletonRows={8}
        empty={
          <EmptyState
            icon={Building2}
            title={q ? "Aucun résultat" : "Personne sur site"}
            description={
              q
                ? "Ajustez la recherche."
                : "Les personnes apparaissent ici dès leur première entrée du jour."
            }
          />
        }
      />

      {/* Print-only signature line */}
      <div className="hidden pt-6 print:block">
        <p className="text-sm text-text-muted">
          Responsable d&apos;évacuation : ______________________ · Signature : ______________________
        </p>
      </div>
    </div>
  );
}
