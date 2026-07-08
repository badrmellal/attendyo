"use client";

/**
 * People — the member directory. Searchable + filterable table. The "Enroll
 * person" action opens a dialog supporting one-photo upload AND webcam capture;
 * the copy emphasizes that one photo is enough.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  UserPlus,
  Users,
  Filter,
  FileUp,
  Mail,
  MessageSquareText,
  Phone,
  Pencil,
  PauseCircle,
  PlayCircle,
  Route,
  Trash2,
} from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { EnrollDialog } from "@/components/EnrollDialog";
import { KioskMessageDialog } from "@/components/KioskMessageDialog";
import { MemberDialog } from "@/components/MemberDialog";
import { MovementTimelineDialog } from "@/components/MovementTimelineDialog";
import { ImportMembersDialog } from "@/components/ImportMembersDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RowMenu, type RowAction } from "@/components/RowMenu";
import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/Avatar";
import { Pill } from "@/components/StatusPill";
import { useBranding } from "@/components/BrandingProvider";
import {
  deleteMember,
  listAccessGroups,
  listMembers,
  memberPhotoSrc,
  todayISO,
  updateMember,
} from "@/lib/api";
import { memberTypeOptions } from "@/lib/terminology";
import type { AccessGroup, Member, MemberStatus, MemberType } from "@/lib/types";
import { cn, formatDate, formatNumber, humanize } from "@/lib/utils";

const STATUS_TONE: Record<MemberStatus, "ok" | "warn" | "muted"> = {
  active: "ok",
  suspended: "warn",
  archived: "muted",
};

/** Validity window already over? (valid_until is an inclusive ISO date) */
function isExpired(m: Member): boolean {
  return !!m.valid_until && m.valid_until < todayISO();
}

export default function PeoplePage() {
  const { term, branding, t, memberStatusLabel } = useBranding();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MemberStatus | "">("");
  const [type, setType] = useState<MemberType | "">("");
  const [department, setDepartment] = useState("");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [accessGroups, setAccessGroups] = useState<AccessGroup[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [messaging, setMessaging] = useState<Member | null>(null);
  const [timelineFor, setTimelineFor] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    listMembers()
      .then(setMembers)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    listAccessGroups().then(setAccessGroups).catch(() => setAccessGroups([]));
  }, []);

  // Quick suspend <-> activate toggle.
  async function toggleStatus(m: Member) {
    const next: MemberStatus = m.status === "active" ? "suspended" : "active";
    setBusyId(m.id);
    try {
      const saved = await updateMember(m.id, { status: next });
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...saved } : x)));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    await deleteMember(deleting.id);
    setMembers((prev) => prev.filter((x) => x.id !== deleting.id));
  }

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
      header: t("people.col.name"),
      cell: (m) => (
        <div className="flex items-center gap-3">
          <Avatar name={m.full_name} src={memberPhotoSrc(m.photo_url)} size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-medium text-text">{m.full_name}</p>
              {m.kiosk_message && (
                <span
                  className="shrink-0 text-accent"
                  title={t("people.msgPending", { msg: m.kiosk_message })}
                  aria-label={t("people.msgPending.aria")}
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <p className="truncate text-xs text-text-muted">
              {m.title || term.memberTypeLabels[m.member_type]}
              {m.external_id ? ` · ${m.external_id}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "department",
      header: term.departmentLabel,
      cell: (m) => <span className="text-sm text-text-muted">{m.department || "—"}</span>,
    },
    {
      key: "type",
      header: t("people.col.type"),
      cell: (m) => (
        <span className="text-sm text-text-muted">{term.memberTypeLabels[m.member_type]}</span>
      ),
    },
    {
      key: "contact",
      header: t("people.col.contact"),
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
      header: t("people.col.status"),
      align: "right",
      cell: (m) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {isExpired(m) && (
            <Pill tone="warn" dot={false}>
              {t("memberStatus.expired")}{" "}
              {m.valid_until ? `· ${formatDate(m.valid_until, branding.locale)}` : ""}
            </Pill>
          )}
          <Pill tone={STATUS_TONE[m.status]}>{memberStatusLabel(m.status)}</Pill>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      cell: (m) => {
        const suspendable = m.status === "active";
        const actions: RowAction[] = [
          { label: t("common.edit"), icon: Pencil, onSelect: () => setEditing(m) },
          {
            label: t("timeline.action"),
            icon: Route,
            onSelect: () => setTimelineFor(m),
          },
          {
            label: t("people.action.message"),
            icon: MessageSquareText,
            onSelect: () => setMessaging(m),
          },
          {
            label: suspendable ? t("common.suspend") : t("common.activate"),
            icon: suspendable ? PauseCircle : PlayCircle,
            disabled: busyId === m.id,
            onSelect: () => toggleStatus(m),
          },
          {
            label: t("common.delete"),
            icon: Trash2,
            tone: "danger",
            onSelect: () => setDeleting(m),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowMenu actions={actions} label={t("people.rowActions", { name: m.full_name })} />
          </div>
        );
      },
    },
  ];

  const activeFilters = [status, type, department].filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            {term.peopleNav}
          </h2>
          <p className="text-sm text-text-muted tnum">
            {t("people.count", {
              filtered: formatNumber(filtered.length, branding.locale),
              total: formatNumber(members.length, branding.locale),
              noun: term.personPlural,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="btn-ghost inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
          >
            <FileUp className="h-4 w-4" />
            {t("common.import")}
          </button>
          <button
            type="button"
            onClick={() => setEnrollOpen(true)}
            className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
          >
            <UserPlus className="h-4 w-4" />
            {t("people.enroll")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("people.searchPlaceholder")}
            className="field w-full py-2 ps-10 pe-3 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-text-muted sm:flex">
            <Filter className="h-3.5 w-3.5" />
            {activeFilters > 0 ? t("filter.count", { n: activeFilters }) : t("common.filters")}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MemberStatus | "")}
            className="field px-3 py-2 text-sm"
          >
            <option value="">{t("filter.allStatuses")}</option>
            <option value="active">{memberStatusLabel("active")}</option>
            <option value="suspended">{memberStatusLabel("suspended")}</option>
            <option value="archived">{memberStatusLabel("archived")}</option>
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MemberType | "")}
            className="field px-3 py-2 text-sm"
          >
            <option value="">{t("filter.allTypes")}</option>
            {memberTypeOptions(term).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={cn("field px-3 py-2 text-sm", departments.length === 0 && "hidden")}
          >
            <option value="">{term.departmentAll}</option>
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
            title={query || activeFilters ? t("common.noResults") : t("people.empty.none.title")}
            description={
              query || activeFilters
                ? t("common.adjustFilters")
                : t("people.empty.none.desc")
            }
            action={
              !query && !activeFilters ? (
                <button
                  type="button"
                  onClick={() => setEnrollOpen(true)}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <UserPlus className="h-4 w-4" /> {t("people.enroll")}
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

      <ImportMembersDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => refresh()}
      />

      <MovementTimelineDialog
        open={timelineFor !== null}
        member={timelineFor}
        onClose={() => setTimelineFor(null)}
      />

      <KioskMessageDialog
        open={messaging !== null}
        member={messaging}
        onClose={() => setMessaging(null)}
        onSaved={(saved) =>
          // Full replace so a CLEARED message (key absent server-side) never
          // leaves a stale gold icon behind.
          setMembers((prev) => prev.map((m) => (m.id === saved.id ? saved : m)))
        }
      />

      <MemberDialog
        open={editing !== null}
        member={editing}
        accessGroups={accessGroups}
        departments={departments}
        onClose={() => setEditing(null)}
        onSaved={(saved) =>
          // PATCH returns the full Member — replace so cleared optional fields
          // (kiosk_message, validity window) don't linger from the old row.
          setMembers((prev) => prev.map((m) => (m.id === saved.id ? saved : m)))
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={t("people.delete.title")}
        confirmLabel={t("common.delete")}
        description={<p>{t("people.delete.desc", { name: deleting?.full_name ?? "" })}</p>}
      />
    </div>
  );
}
