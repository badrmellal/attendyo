"use client";

/**
 * Access groups — who may open which doors, and when (`/api/access-groups`).
 * Card grid: each group shows its door chips and a readable schedule summary
 * ("Toujours autorisé" or per-day windows), plus member count. Full CRUD via
 * AccessGroupDialog; deletes are confirmed and warn about member fallout.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, DoorOpen, KeyRound, Pencil, Plus, Trash2, Users } from "lucide-react";
import { AccessGroupDialog } from "@/components/AccessGroupDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { RowMenu, type RowAction } from "@/components/RowMenu";
import { useBranding } from "@/components/BrandingProvider";
import { deleteAccessGroup, listAccessGroups, listDoors, listMembers } from "@/lib/api";
import type { AccessGroup, Door, Member, ScheduleDay } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

const DAY_ORDER: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function GroupsPage() {
  const { t, branding } = useBranding();
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; group: AccessGroup | null }>({
    open: false,
    group: null,
  });
  const [deleting, setDeleting] = useState<AccessGroup | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listAccessGroups(), listDoors(), listMembers()])
      .then(([g, d, m]) => {
        if (!active) return;
        setGroups(g);
        setDoors(d);
        setMembers(m);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const doorName = useMemo(() => {
    const map = new Map(doors.map((d) => [d.id, d.name]));
    return (id: string) => map.get(id) ?? t("groups.doorDeleted");
  }, [doors, t]);

  const memberCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) {
      if (m.access_group_id) {
        counts.set(m.access_group_id, (counts.get(m.access_group_id) ?? 0) + 1);
      }
    }
    return (id: string) => counts.get(id) ?? 0;
  }, [members]);

  function onSaved(saved: AccessGroup) {
    setGroups((prev) =>
      prev.some((g) => g.id === saved.id)
        ? prev.map((g) => (g.id === saved.id ? saved : g))
        : [...prev, saved],
    );
  }

  async function confirmDelete() {
    if (!deleting) return;
    const id = deleting.id;
    await deleteAccessGroup(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
    // Members referencing the group lose it (API: ON DELETE SET NULL).
    setMembers((prev) =>
      prev.map((m) => (m.access_group_id === id ? { ...m, access_group_id: undefined } : m)),
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            {t("groups.title")}
          </h2>
          <p className="text-sm text-text-muted tnum">
            {t("groups.count", { n: formatNumber(groups.length, branding.locale) })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ open: true, group: null })}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          {t("groups.new")}
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-48 p-5">
              <div className="skeleton mb-4 h-6 w-1/2" />
              <div className="skeleton mb-2 h-4 w-3/4" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={KeyRound}
            title={t("groups.empty.title")}
            description={t("groups.empty.desc")}
            action={
              <button
                type="button"
                onClick={() => setDialog({ open: true, group: null })}
                className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> {t("groups.new")}
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const scheduleDays = DAY_ORDER.filter((d) => group.schedule?.[d]);
            const always = scheduleDays.length === 0;
            const actions: RowAction[] = [
              {
                label: t("common.edit"),
                icon: Pencil,
                onSelect: () => setDialog({ open: true, group }),
              },
              {
                label: t("common.delete"),
                icon: Trash2,
                tone: "danger",
                onSelect: () => setDeleting(group),
              },
            ];
            return (
              <div key={group.id} className="card flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                      <KeyRound className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-display font-semibold text-text">{group.name}</h3>
                      <p className="flex items-center gap-1 text-xs text-text-muted">
                        <Users className="h-3 w-3" />
                        <span className="tnum">
                          {t("groups.members", {
                            n: formatNumber(memberCount(group.id), branding.locale),
                          })}
                        </span>
                      </p>
                    </div>
                  </div>
                  <RowMenu actions={actions} label={t("people.rowActions", { name: group.name })} />
                </div>

                {/* Doors */}
                <div className="mt-4">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {t("groups.doors")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.door_ids.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/[0.06] px-2 py-1 text-xs text-primary">
                        <DoorOpen className="h-3.5 w-3.5" /> {t("groups.allDoors")}
                      </span>
                    ) : (
                      group.door_ids.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2/40 px-2 py-1 text-xs text-text-muted"
                        >
                          <DoorOpen className="h-3.5 w-3.5" /> {doorName(id)}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Schedule */}
                <div className="mt-4">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {t("groups.schedule")}
                  </p>
                  {always ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/[0.06] px-2 py-1 text-xs text-primary">
                      <CalendarClock className="h-3.5 w-3.5" /> {t("groups.always")}
                    </span>
                  ) : (
                    <ul className="space-y-1">
                      {scheduleDays.map((d) => {
                        const window = group.schedule[d] as [string, string];
                        return (
                          <li
                            key={d}
                            className="flex items-center justify-between rounded-md border border-border bg-surface-2/30 px-2.5 py-1.5 text-xs"
                          >
                            <span className="font-medium text-text">{t(`day.${d}`)}</span>
                            <span className="tnum text-text-muted">
                              {window[0]} → {window[1]}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AccessGroupDialog
        open={dialog.open}
        group={dialog.group}
        doors={doors}
        onClose={() => setDialog({ open: false, group: null })}
        onSaved={onSaved}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={t("groups.delete.title")}
        confirmLabel={t("common.delete")}
        description={
          <p>
            {t("groups.delete.desc", { name: deleting?.name ?? "" })}
            {deleting && memberCount(deleting.id) > 0
              ? ` ${t("groups.delete.members", { n: memberCount(deleting.id) })}`
              : ""}
          </p>
        }
      />
    </div>
  );
}
