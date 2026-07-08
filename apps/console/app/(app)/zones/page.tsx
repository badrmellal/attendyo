"use client";

/**
 * Zones & spaces — the spatial tree behind v3 Spatial Intelligence. Buildings
 * hold floors, floors hold areas; doors bind to a zone, so camera → door → zone
 * turns every recognition into a zone-level location fix.
 *
 * CRUD via the shared Dialog / ConfirmDialog / RowMenu primitives. The table
 * shows the hierarchy (children indented under parents), the door count bound to
 * each zone, capacity and connected load. Everything mutates offline in MOCK.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Building2, Layers, Square, Plus, Pencil, Trash2, DoorOpen } from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { RowMenu, type RowAction } from "@/components/RowMenu";
import { ZoneDialog } from "@/components/ZoneDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Pill } from "@/components/StatusPill";
import { useBranding } from "@/components/BrandingProvider";
import { deleteZone, getZones, listDoors } from "@/lib/api";
import type { Door, Zone, ZoneKind } from "@/lib/types";

const KIND_ICON: Record<ZoneKind, typeof Building2> = {
  building: Building2,
  floor: Layers,
  area: Square,
};

type Row = { zone: Zone; depth: number };

/** Depth-first order: roots (or orphaned children) first, children indented. */
function orderZones(zones: Zone[]): Row[] {
  const ids = new Set(zones.map((z) => z.id));
  const byParent = new Map<string, Zone[]>();
  for (const z of zones) {
    // A missing/dangling parent is treated as a root.
    const key = z.parent_id && ids.has(z.parent_id) ? z.parent_id : "__root__";
    byParent.set(key, [...(byParent.get(key) ?? []), z]);
  }
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    const kids = (byParent.get(key) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const z of kids) {
      if (seen.has(z.id)) continue; // cycle guard
      seen.add(z.id);
      out.push({ zone: z, depth });
      walk(z.id, depth + 1);
    }
  };
  walk("__root__", 0);
  // Any zone not reached (part of a cycle) still gets listed at the root.
  for (const z of zones) if (!seen.has(z.id)) out.push({ zone: z, depth: 0 });
  return out;
}

export default function ZonesPage() {
  const { t } = useBranding();
  const [zones, setZones] = useState<Zone[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; zone: Zone | null }>({
    open: false,
    zone: null,
  });
  const [deleting, setDeleting] = useState<Zone | null>(null);

  const reload = useCallback(() => {
    return Promise.all([getZones(), listDoors()]).then(([z, d]) => {
      setZones(z);
      setDoors(d);
    });
  }, []);

  useEffect(() => {
    let active = true;
    reload().finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [reload]);

  async function confirmDelete() {
    if (!deleting) return;
    await deleteZone(deleting.id);
    await reload();
  }

  const rows = useMemo(() => orderZones(zones), [zones]);
  const doorsByZone = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of doors) if (d.zone_id) m.set(d.zone_id, (m.get(d.zone_id) ?? 0) + 1);
    return m;
  }, [doors]);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("zones.field.name"),
      cell: ({ zone, depth }) => {
        const Icon = KIND_ICON[zone.kind];
        return (
          <div className="flex items-center gap-2.5" style={{ paddingInlineStart: depth * 20 }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2/60 text-text-muted ring-1 ring-border">
              <Icon className="h-4 w-4" />
            </span>
            <span className="font-medium text-text">{zone.name}</span>
          </div>
        );
      },
    },
    {
      key: "kind",
      header: t("zones.col.kind"),
      cell: ({ zone }) => (
        <Pill tone="muted" dot={false}>
          {t(`zones.kind.${zone.kind}`)}
        </Pill>
      ),
    },
    {
      key: "doors",
      header: t("zones.col.doors"),
      cell: ({ zone }) => {
        const n = doorsByZone.get(zone.id) ?? 0;
        return (
          <span className="inline-flex items-center gap-1.5 text-sm text-text-muted">
            <DoorOpen className="h-3.5 w-3.5" />
            <span className="tnum text-text">{n}</span>
          </span>
        );
      },
    },
    {
      key: "capacity",
      header: t("zones.col.capacity"),
      cell: ({ zone }) => (
        <span className="tnum text-sm text-text-muted">
          {zone.capacity != null ? zone.capacity : "—"}
        </span>
      ),
    },
    {
      key: "energy",
      header: t("zones.field.energyKw"),
      cell: ({ zone }) => (
        <span className="tnum text-sm text-text-muted">
          {zone.energy_kw != null ? `${zone.energy_kw} kW` : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      cell: ({ zone }) => {
        const actions: RowAction[] = [
          { label: t("common.edit"), icon: Pencil, onSelect: () => setDialog({ open: true, zone }) },
          {
            label: t("common.delete"),
            icon: Trash2,
            tone: "danger",
            onSelect: () => setDeleting(zone),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowMenu actions={actions} label={`${t("common.edit")} — ${zone.name}`} />
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            {t("zones.title")}
          </h2>
          <p className="text-sm text-text-muted">{t("zones.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ open: true, zone: null })}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          {t("zones.add")}
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.zone.id}
        loading={loading}
        empty={
          <EmptyState
            icon={Boxes}
            title={t("zones.empty.title")}
            description={t("zones.empty.desc")}
            action={
              <button
                type="button"
                onClick={() => setDialog({ open: true, zone: null })}
                className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> {t("zones.add")}
              </button>
            }
          />
        }
      />

      <ZoneDialog
        open={dialog.open}
        zone={dialog.zone}
        zones={zones}
        onClose={() => setDialog({ open: false, zone: null })}
        onSaved={() => reload()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={t("zones.delete.title")}
        confirmLabel={t("common.delete")}
        description={<p>{t("zones.delete.desc", { name: deleting?.name ?? "" })}</p>}
      />
    </div>
  );
}
