"use client";

/**
 * Énergie — occupancy-driven energy automation. When a zone sits empty past its
 * threshold the rule fires OFF; the first person back fires it ON. Attendyo only
 * emits the on/off signal to the buyer's own relay / BMS URL (their LAN) or runs
 * in simulation — it is not itself an HVAC controller.
 *
 * A savings card sums kWh (zone.energy_kw × hours off) over the chosen period,
 * and a per-rule table shows each rule's state and last change. CRUD via the
 * shared dialog primitives; everything mutates offline in MOCK.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap, Plus, Pencil, Trash2, Power, Leaf, Clock, FlaskConical } from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { RowMenu, type RowAction } from "@/components/RowMenu";
import { EnergyRuleDialog } from "@/components/EnergyRuleDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Pill } from "@/components/StatusPill";
import { useBranding } from "@/components/BrandingProvider";
import {
  deleteEnergyRule,
  getEnergyRules,
  getEnergySummary,
  getZones,
} from "@/lib/api";
import type { EnergyPeriod, EnergyRule, EnergySummary, Zone } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const PERIODS: EnergyPeriod[] = ["today", "week", "month"];

export default function EnergyPage() {
  const { t, locale } = useBranding();
  const [rules, setRules] = useState<EnergyRule[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [summary, setSummary] = useState<EnergySummary | null>(null);
  const [period, setPeriod] = useState<EnergyPeriod>("month");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; rule: EnergyRule | null }>({
    open: false,
    rule: null,
  });
  const [deleting, setDeleting] = useState<EnergyRule | null>(null);

  const reloadRules = useCallback(() => {
    return Promise.all([getEnergyRules(), getZones()]).then(([r, z]) => {
      setRules(r);
      setZones(z);
    });
  }, []);

  useEffect(() => {
    let active = true;
    reloadRules().finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [reloadRules]);

  // The savings summary re-computes whenever the period changes (and after a
  // rule mutation, via the `rules` dependency).
  useEffect(() => {
    let active = true;
    getEnergySummary(period)
      .then((s) => active && setSummary(s))
      .catch(() => active && setSummary(null));
    return () => {
      active = false;
    };
  }, [period, rules]);

  async function confirmDelete() {
    if (!deleting) return;
    await deleteEnergyRule(deleting.id);
    await reloadRules();
  }

  const zoneName = useCallback(
    (id: string) => zones.find((z) => z.id === id)?.name ?? "—",
    [zones],
  );

  const savingsByRule = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of summary?.per_rule ?? []) m.set(r.rule_id, r.kwh_saved);
    return m;
  }, [summary]);

  const columns: Column<EnergyRule>[] = [
    {
      key: "name",
      header: t("energy.field.name"),
      cell: (r) => (
        <div className={cn("min-w-0", !r.enabled && "opacity-60")}>
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-text">{r.name}</span>
            {r.driver === "simulation" && (
              <Pill tone="info" dot={false}>
                <FlaskConical className="h-3 w-3" />
                {t("energy.driver.simulation")}
              </Pill>
            )}
          </div>
          <p className="text-xs text-text-muted">
            <span className="tnum">{r.empty_minutes}</span> min ·{" "}
            {t(`energy.driver.${r.driver}`)}
          </p>
        </div>
      ),
    },
    {
      key: "zone",
      header: t("energy.field.zone"),
      cell: (r) => <span className="text-sm text-text-muted">{zoneName(r.zone_id)}</span>,
    },
    {
      key: "state",
      header: t("energy.col.state"),
      cell: (r) => (
        <div className="space-y-0.5">
          <Pill tone={r.state === "off" ? "ok" : "muted"} dot>
            {r.state === "off" ? t("energy.state.off") : t("energy.state.on")}
          </Pill>
          {r.last_changed && (
            <p className="text-[11px] text-text-muted">{formatDateTime(r.last_changed, locale)}</p>
          )}
        </div>
      ),
    },
    {
      key: "savings",
      header: t("energy.col.savings"),
      align: "right",
      cell: (r) => {
        const kwh = savingsByRule.get(r.id);
        return (
          <span className="tnum text-sm text-text">
            {kwh != null ? `${kwh} kWh` : "—"}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      cell: (r) => {
        const actions: RowAction[] = [
          { label: t("common.edit"), icon: Pencil, onSelect: () => setDialog({ open: true, rule: r }) },
          {
            label: t("common.delete"),
            icon: Trash2,
            tone: "danger",
            onSelect: () => setDeleting(r),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowMenu actions={actions} label={`${t("common.edit")} — ${r.name}`} />
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
            {t("energy.title")}
          </h2>
          <p className="text-sm text-text-muted">{t("energy.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ open: true, rule: null })}
          disabled={zones.length === 0}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {t("energy.add")}
        </button>
      </div>

      {/* Savings summary */}
      <div className="card overflow-hidden p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Leaf className="h-6 w-6" />
            </span>
            <div>
              <p className="flex items-baseline gap-2">
                <span className="tnum font-display text-3xl font-semibold text-text">
                  {summary ? summary.kwh_saved : "—"}
                </span>
                <span className="text-sm text-text-muted">kWh · {t("energy.kwhSaved")}</span>
              </p>
              <p className="mt-0.5 text-sm text-text-muted">
                {summary ? `${t("energy.zonesOff", { n: summary.off_now })} · ${summary.hours_off} h` : "—"}
              </p>
            </div>
          </div>

          {/* Period segmented control */}
          <div className="inline-flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-text-muted" />
            <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    period === p
                      ? "bg-primary/15 text-primary"
                      : "text-text-muted hover:text-text",
                  )}
                >
                  {t(`energy.period.${p}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Small stat row */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MiniStat label={t("energy.rules")} value={summary ? summary.rules : "—"} icon={Zap} />
          <MiniStat label={t("energy.offNow")} value={summary ? summary.off_now : "—"} icon={Power} />
          <MiniStat
            label={t("energy.hoursOff")}
            value={summary ? `${summary.hours_off} h` : "—"}
            icon={Clock}
          />
        </div>
      </div>

      {/* Rules table */}
      <DataTable
        columns={columns}
        rows={rules}
        rowKey={(r) => r.id}
        loading={loading}
        empty={
          <EmptyState
            icon={Zap}
            title={t("energy.empty.title")}
            description={t("energy.empty.desc")}
            action={
              zones.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setDialog({ open: true, rule: null })}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <Plus className="h-4 w-4" /> {t("energy.add")}
                </button>
              ) : undefined
            }
          />
        }
      />

      <EnergyRuleDialog
        open={dialog.open}
        rule={dialog.rule}
        zones={zones}
        onClose={() => setDialog({ open: false, rule: null })}
        onSaved={() => reloadRules()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={t("energy.delete.title")}
        confirmLabel={t("common.delete")}
        description={<p>{t("energy.delete.desc", { name: deleting?.name ?? "" })}</p>}
      />
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Zap;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/30 px-3.5 py-3">
      <Icon className="h-4 w-4 shrink-0 text-text-muted" />
      <div className="min-w-0">
        <p className="tnum text-lg font-semibold text-text">{value}</p>
        <p className="truncate text-xs text-text-muted">{label}</p>
      </div>
    </div>
  );
}
