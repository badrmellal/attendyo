"use client";

/**
 * Team & audit — admin-only.
 *  - Operators: CRUD on Console accounts (`/api/users`). The UI refuses
 *    self-delete outright (the API also enforces it with a 409), and edits
 *    never expose password hashes.
 *  - Audit: the append-only compliance trail (`GET /api/audit`) — filterable
 *    by action, details expandable per row.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/Avatar";
import { Pill } from "@/components/StatusPill";
import { RowMenu, type RowAction } from "@/components/RowMenu";
import { UserDialog } from "@/components/UserDialog";
import { useBranding } from "@/components/BrandingProvider";
import { listAudit, listUsers, me, deleteUser } from "@/lib/api";
import type { AuditEntry, AuthUser, OperatorRole, OperatorUser } from "@/lib/types";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

const ROLE_META: Record<OperatorRole, { label: string; tone: "ok" | "info" | "muted" }> = {
  admin: { label: "Administrateur", tone: "ok" },
  operator: { label: "Opérateur", tone: "info" },
  viewer: { label: "Lecteur", tone: "muted" },
};

/** Known audit actions, straight from CONTRACT.md (the filter's option list). */
const AUDIT_ACTIONS = [
  "login",
  "member.create",
  "member.update",
  "member.delete",
  "member.import",
  "door.create",
  "door.update",
  "door.delete",
  "door.open",
  "camera.create",
  "camera.update",
  "camera.delete",
  "access_group.create",
  "access_group.update",
  "access_group.delete",
  "settings.update",
  "user.create",
  "user.update",
  "user.delete",
  "alerts.ack",
];

type Tab = "operators" | "audit";

export default function TeamPage() {
  const { branding } = useBranding();
  const [self, setSelf] = useState<AuthUser | null>(null);
  const [selfLoading, setSelfLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("operators");

  // Operators
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userDialog, setUserDialog] = useState<{ open: boolean; user: OperatorUser | null }>({
    open: false,
    user: null,
  });
  const [deleting, setDeleting] = useState<OperatorUser | null>(null);

  // Audit
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let active = true;
    me()
      .then((u) => active && setSelf(u))
      .catch(() => active && setSelf(null))
      .finally(() => active && setSelfLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const isAdmin = self?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setUsersLoading(true);
    listUsers()
      .then((rows) => active && setUsers(rows))
      .catch(() => active && setUsers([]))
      .finally(() => active && setUsersLoading(false));
    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setAuditLoading(true);
    listAudit({ limit: 100, action: actionFilter || undefined })
      .then((rows) => active && setAudit(rows))
      .catch(() => active && setAudit([]))
      .finally(() => active && setAuditLoading(false));
    return () => {
      active = false;
    };
  }, [isAdmin, actionFilter]);

  const adminCount = useMemo(() => users.filter((u) => u.role === "admin").length, [users]);

  function onUserSaved(saved: OperatorUser) {
    setUsers((prev) =>
      prev.some((u) => u.id === saved.id)
        ? prev.map((u) => (u.id === saved.id ? saved : u))
        : [...prev, saved],
    );
  }

  async function confirmDelete() {
    if (!deleting) return;
    await deleteUser(deleting.id);
    setUsers((prev) => prev.filter((u) => u.id !== deleting.id));
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- guards -------------------------------------------------------------
  if (selfLoading) {
    return (
      <div className="grid gap-4">
        <div className="card h-24" />
        <div className="card h-72" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="card">
        <EmptyState
          icon={Lock}
          title="Réservé aux administrateurs"
          description="La gestion de l'équipe et le journal d'audit nécessitent le rôle administrateur."
        />
      </div>
    );
  }

  // ---- columns ------------------------------------------------------------
  const userColumns: Column<OperatorUser>[] = [
    {
      key: "user",
      header: "Opérateur",
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.full_name || u.email} size={32} />
          <div className="min-w-0">
            <p className="truncate font-medium text-text">
              {u.full_name || u.email}
              {u.email === self?.email && (
                <span className="ml-2 text-xs font-normal text-text-muted">(vous)</span>
              )}
            </p>
            <p className="truncate text-xs text-text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Rôle",
      cell: (u) => <Pill tone={ROLE_META[u.role].tone}>{ROLE_META[u.role].label}</Pill>,
    },
    {
      key: "created",
      header: "Créé le",
      align: "right",
      cell: (u) => (
        <span className="tnum text-sm text-text-muted">
          {formatDate(u.created_at, branding.locale)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      cell: (u) => {
        const isSelf = u.email === self?.email;
        const lastAdmin = u.role === "admin" && adminCount <= 1;
        const actions: RowAction[] = [
          {
            label: "Modifier",
            icon: Pencil,
            onSelect: () => setUserDialog({ open: true, user: u }),
          },
          {
            label: isSelf
              ? "Supprimer (votre compte)"
              : lastAdmin
                ? "Supprimer (dernier admin)"
                : "Supprimer",
            icon: Trash2,
            tone: "danger",
            // The UI refuses self-delete and last-admin outright; the API
            // would answer 409 anyway — never offer a doomed action.
            disabled: isSelf || lastAdmin,
            onSelect: () => setDeleting(u),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowMenu actions={actions} label={`Actions pour ${u.email}`} />
          </div>
        );
      },
    },
  ];

  const auditColumns: Column<AuditEntry>[] = [
    {
      key: "expand",
      header: "",
      className: "w-8",
      cell: (e) =>
        Object.keys(e.details).length > 0 ? (
          expanded.has(e.id) ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" />
          )
        ) : null,
    },
    {
      key: "ts",
      header: "Horodatage",
      cell: (e) => (
        <span className="tnum whitespace-nowrap text-sm text-text-muted">
          {formatDateTime(e.ts, branding.locale)}
        </span>
      ),
    },
    {
      key: "user",
      header: "Utilisateur",
      cell: (e) => <span className="text-sm text-text">{e.user_email || "—"}</span>,
    },
    {
      key: "action",
      header: "Action",
      cell: (e) => (
        <code className="rounded-md bg-surface-2/60 px-2 py-0.5 text-xs text-primary">
          {e.action}
        </code>
      ),
    },
    {
      key: "entity",
      header: "Entité",
      cell: (e) => (
        <span className="text-sm text-text-muted">
          {e.entity || "—"}
          {e.entity_id && (
            <span className="tnum ml-1 text-xs opacity-70">#{e.entity_id.slice(0, 8)}</span>
          )}
        </span>
      ),
    },
    {
      key: "details",
      header: "Détails",
      cell: (e) => {
        const keys = Object.keys(e.details);
        if (keys.length === 0) return <span className="text-xs text-text-muted">—</span>;
        return expanded.has(e.id) ? (
          <pre className="max-w-md overflow-x-auto rounded-md bg-bg/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
            {JSON.stringify(e.details, null, 2)}
          </pre>
        ) : (
          <span className="text-xs text-text-muted">
            {keys.length} champ(s) — cliquer pour détailler
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header + tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            Équipe & audit
          </h2>
          <p className="text-sm text-text-muted">
            Comptes de la Console et journal des actions (conformité).
          </p>
        </div>
        {tab === "operators" ? (
          <button
            type="button"
            onClick={() => setUserDialog({ open: true, user: null })}
            className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
          >
            <UserPlus className="h-4 w-4" />
            Nouvel opérateur
          </button>
        ) : (
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="field px-3 py-2 text-sm"
            aria-label="Filtrer par action"
          >
            <option value="">Toutes les actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
        <button
          type="button"
          onClick={() => setTab("operators")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "operators" ? "bg-surface text-text shadow-sm" : "text-text-muted",
          )}
        >
          <UsersRound className="h-4 w-4" /> Opérateurs
        </button>
        <button
          type="button"
          onClick={() => setTab("audit")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "audit" ? "bg-surface text-text shadow-sm" : "text-text-muted",
          )}
        >
          <ScrollText className="h-4 w-4" /> Journal d&apos;audit
        </button>
      </div>

      {tab === "operators" ? (
        <DataTable
          columns={userColumns}
          rows={users}
          rowKey={(u) => u.id}
          loading={usersLoading}
          skeletonRows={4}
          empty={
            <EmptyState
              icon={UsersRound}
              title="Aucun opérateur"
              description="Ajoutez les comptes de votre équipe sécurité et RH."
              action={
                <button
                  type="button"
                  onClick={() => setUserDialog({ open: true, user: null })}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <Plus className="h-4 w-4" /> Nouvel opérateur
                </button>
              }
            />
          }
        />
      ) : (
        <DataTable
          columns={auditColumns}
          rows={audit}
          rowKey={(e) => String(e.id)}
          loading={auditLoading}
          skeletonRows={8}
          onRowClick={(e) => {
            if (Object.keys(e.details).length > 0) toggleExpanded(e.id);
          }}
          empty={
            <EmptyState
              icon={ScrollText}
              title="Journal vide"
              description={
                actionFilter
                  ? "Aucune entrée pour cette action — élargissez le filtre."
                  : "Chaque action d'opérateur sera consignée ici, en lecture seule."
              }
            />
          }
        />
      )}

      <UserDialog
        open={userDialog.open}
        user={userDialog.user}
        onClose={() => setUserDialog({ open: false, user: null })}
        onSaved={onUserSaved}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Supprimer l'opérateur"
        confirmLabel="Supprimer"
        description={
          <p>
            Supprimer le compte{" "}
            <span className="font-medium text-text">{deleting?.email}</span> ? La personne ne
            pourra plus se connecter à la Console. Cette action est tracée dans l&apos;audit.
          </p>
        }
      />
    </div>
  );
}
