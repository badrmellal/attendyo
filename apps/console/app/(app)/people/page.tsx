"use client";

/**
 * People — the member directory. Searchable + filterable table. The "Enroll
 * person" action opens a dialog supporting one-photo upload AND webcam capture;
 * the copy emphasizes that one photo is enough.
 */

import { useEffect, useMemo, useState } from "react";
import { Search, UserPlus, Users, Filter, Mail, Phone } from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { EnrollDialog } from "@/components/EnrollDialog";
import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/Avatar";
import { Pill } from "@/components/StatusPill";
import { useBranding } from "@/components/BrandingProvider";
import { listMembers } from "@/lib/api";
import type { Member, MemberStatus, MemberType } from "@/lib/types";
import { cn, humanize } from "@/lib/utils";

const STATUS_TONE: Record<MemberStatus, "ok" | "warn" | "muted"> = {
  active: "ok",
  suspended: "warn",
  archived: "muted",
};

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Actif",
  suspended: "Suspendu",
  archived: "Archivé",
};

const TYPE_LABEL: Record<MemberType, string> = {
  employee: "Employé",
  resident: "Résident",
  contractor: "Prestataire",
  visitor: "Visiteur",
};

export default function PeoplePage() {
  const { t } = useBranding();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MemberStatus | "">("");
  const [type, setType] = useState<MemberType | "">("");
  const [department, setDepartment] = useState("");
  const [enrollOpen, setEnrollOpen] = useState(false);

  function refresh() {
    setLoading(true);
    listMembers()
      .then(setMembers)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  const departments = useMemo(
    () =>
      Array.from(new Set(members.map((m) => m.department).filter(Boolean) as string[])).sort(),
    [members],
  );

  // Client-side filtering keeps the UI instant in mock mode; the API also
  // accepts these as query params for the real backend.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (status && m.status !== status) return false;
      if (type && m.member_type !== type) return false;
      if (department && m.department !== department) return false;
      if (q) {
        const hay = [m.full_name, m.email, m.external_id, m.department, m.title]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [members, query, status, type, department]);

  const columns: Column<Member>[] = [
    {
      key: "name",
      header: "Nom",
      cell: (m) => (
        <div className="flex items-center gap-3">
          <Avatar name={m.full_name} src={m.photo_url} size={36} />
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{m.full_name}</p>
            <p className="truncate text-xs text-text-muted">
              {m.title || TYPE_LABEL[m.member_type]}
              {m.external_id ? ` · ${m.external_id}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "department",
      header: "Département",
      cell: (m) => <span className="text-sm text-text-muted">{m.department || "—"}</span>,
    },
    {
      key: "type",
      header: "Type",
      cell: (m) => (
        <span className="text-sm text-text-muted">{TYPE_LABEL[m.member_type]}</span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (m) => (
        <div className="space-y-0.5">
          {m.email && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <Mail className="h-3 w-3" /> <span className="truncate">{m.email}</span>
            </p>
          )}
          {m.phone && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <Phone className="h-3 w-3" /> <span className="tnum">{m.phone}</span>
            </p>
          )}
          {!m.email && !m.phone && <span className="text-xs text-text-muted">—</span>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Statut",
      align: "right",
      cell: (m) => (
        <div className="flex justify-end">
          <Pill tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Pill>
        </div>
      ),
    },
  ];

  const activeFilters = [status, type, department].filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            {t("nav.people")}
          </h2>
          <p className="text-sm text-text-muted">
            <span className="tnum font-medium text-text">{filtered.length}</span> sur{" "}
            <span className="tnum">{members.length}</span> personnes
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnrollOpen(true)}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
        >
          <UserPlus className="h-4 w-4" />
          Enregistrer une personne
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par nom, e-mail, identifiant…"
            className="field w-full py-2 pl-10 pr-3 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-text-muted sm:flex">
            <Filter className="h-3.5 w-3.5" />
            {activeFilters > 0 ? `${activeFilters} filtre(s)` : "Filtres"}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MemberStatus | "")}
            className="field px-3 py-2 text-sm"
          >
            <option value="">Tous statuts</option>
            <option value="active">Actif</option>
            <option value="suspended">Suspendu</option>
            <option value="archived">Archivé</option>
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MemberType | "")}
            className="field px-3 py-2 text-sm"
          >
            <option value="">Tous types</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={cn("field px-3 py-2 text-sm", departments.length === 0 && "hidden")}
          >
            <option value="">Tous départements</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {humanize(d)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(m) => m.id}
        loading={loading}
        empty={
          <EmptyState
            icon={Users}
            title={query || activeFilters ? "Aucun résultat" : "Aucune personne enregistrée"}
            description={
              query || activeFilters
                ? "Ajustez la recherche ou les filtres."
                : "Enregistrez votre première personne — une seule photo suffit."
            }
            action={
              !query && !activeFilters ? (
                <button
                  type="button"
                  onClick={() => setEnrollOpen(true)}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <UserPlus className="h-4 w-4" /> Enregistrer une personne
                </button>
              ) : undefined
            }
          />
        }
      />

      <EnrollDialog
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        departments={departments}
        onEnrolled={(m) => setMembers((prev) => [m, ...prev])}
      />
    </div>
  );
}
