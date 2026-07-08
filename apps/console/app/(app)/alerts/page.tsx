"use client";

/**
 * Alerts — persistent, acknowledgeable security notifications (`/api/alerts`).
 *  - Filter: all / unacknowledged, plus a kind selector.
 *  - Unacknowledged rows are highlighted; each carries an "Acquitter" action.
 *  - "Tout acquitter" behind a ConfirmDialog.
 *  - Live: new alerts arrive over SSE (`event: alert`) and prepend instantly.
 *  Every ack fires the app-wide signal so the TopBar bell badge stays honest.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  DoorOpen,
  Loader2,
  Repeat2,
  ShieldAlert,
  ShieldQuestion,
  Clock3,
  Cog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Pill } from "@/components/StatusPill";
import { useBranding } from "@/components/BrandingProvider";
import { ackAlert, ackAllAlerts, listAlerts, notifyAlertsChanged, streamEvents } from "@/lib/api";
import type { Alert, AlertKind, AlertSeverity } from "@/lib/types";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

// Labels come from the i18n layer (alertKindLabel / alertSeverityLabel); this
// map holds only the icon + tone, which are locale-independent.
const KIND_META: Record<AlertKind, { icon: LucideIcon; tone: "danger" | "warn" | "info" }> = {
  unknown_face: { icon: ShieldQuestion, tone: "danger" },
  not_authorized: { icon: ShieldAlert, tone: "warn" },
  off_schedule: { icon: Clock3, tone: "warn" },
  anti_passback: { icon: Repeat2, tone: "info" },
  system: { icon: Cog, tone: "info" },
};

const SEVERITY_TONE: Record<AlertSeverity, "info" | "warn" | "danger"> = {
  info: "info",
  warning: "warn",
  critical: "danger",
};

const TONE_RING: Record<string, string> = {
  danger: "text-danger bg-danger/10 ring-danger/20",
  warn: "text-accent bg-accent/10 ring-accent/20",
  info: "text-info bg-info/10 ring-info/20",
};

type Scope = "all" | "unack";

export default function AlertsPage() {
  const { branding, t, alertKindLabel, alertSeverityLabel } = useBranding();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("unack");
  const [kind, setKind] = useState<AlertKind | "">("");
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const seen = useRef<Set<number>>(new Set());

  // Load whenever the filters change. The list is filtered server-side per the
  // contract; the SSE prepend below re-applies the same filters client-side.
  useEffect(() => {
    let active = true;
    setLoading(true);
    listAlerts({
      acknowledged: scope === "unack" ? false : undefined,
      kind: kind || undefined,
      limit: 100,
    })
      .then((rows) => {
        if (!active) return;
        seen.current = new Set(rows.map((a) => a.id));
        setAlerts(rows);
      })
      .catch(() => active && setAlerts([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [scope, kind]);

  // Live prepend for fresh alerts (they arrive unacknowledged).
  useEffect(() => {
    const unsub = streamEvents(() => {}, {
      onAlert: (alert) => {
        if (kind && alert.kind !== kind) return;
        // Track seen ids OUTSIDE the state updater: React StrictMode double-
        // invokes updaters, and a mutating updater would mark the id as seen on
        // the first (discarded) pass and then drop the alert on the second.
        if (seen.current.has(alert.id)) return;
        seen.current.add(alert.id);
        setAlerts((prev) =>
          prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev],
        );
      },
    });
    return unsub;
  }, [kind]);

  const unackCount = useMemo(() => alerts.filter((a) => !a.acknowledged).length, [alerts]);

  async function ack(alert: Alert) {
    setAckingId(alert.id);
    try {
      const saved = await ackAlert(alert.id);
      setAlerts((prev) =>
        scope === "unack"
          ? prev.filter((a) => a.id !== alert.id)
          : prev.map((a) => (a.id === alert.id ? saved : a)),
      );
      notifyAlertsChanged();
    } finally {
      setAckingId(null);
    }
  }

  async function ackAll() {
    await ackAllAlerts();
    const now = new Date().toISOString();
    setAlerts((prev) =>
      scope === "unack" ? [] : prev.map((a) => (a.acknowledged ? a : { ...a, acknowledged: true, acknowledged_at: now })),
    );
    notifyAlertsChanged();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            {t("nav.alerts")}
          </h2>
          <p className="text-sm text-text-muted">
            {unackCount > 0
              ? t("alerts.subtitle.some", { n: unackCount })
              : t("alerts.subtitle.none")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmAll(true)}
          disabled={unackCount === 0}
          className="btn-ghost inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          <CheckCheck className="h-4 w-4" />
          {t("alerts.ackAll")}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
          <button
            type="button"
            onClick={() => setScope("unack")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              scope === "unack" ? "bg-surface text-text shadow-sm" : "text-text-muted",
            )}
          >
            <BellRing className="h-4 w-4" /> {t("alerts.scope.unack")}
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              scope === "all" ? "bg-surface text-text shadow-sm" : "text-text-muted",
            )}
          >
            <BellOff className="h-4 w-4" /> {t("alerts.scope.all")}
          </button>
        </div>

        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AlertKind | "")}
          className="field px-3 py-2 text-sm"
          aria-label={t("alerts.filterAria")}
        >
          <option value="">{t("filter.allKinds")}</option>
          {(Object.keys(KIND_META) as AlertKind[]).map((k) => (
            <option key={k} value={k}>
              {alertKindLabel(k)}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-quiet flex items-center gap-3 px-4 py-3.5">
              <div className="skeleton h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={BellOff}
            title={scope === "unack" ? t("alerts.empty.unack.title") : t("alerts.empty.all.title")}
            description={kind ? t("alerts.empty.kind.desc") : t("alerts.empty.desc")}
          />
        </div>
      ) : (
        <ul className="space-y-2.5">
          {alerts.map((alert) => {
            const meta = KIND_META[alert.kind];
            const severityTone = SEVERITY_TONE[alert.severity];
            const Icon = meta.icon;
            return (
              <li
                key={alert.id}
                className={cn(
                  "flex animate-slide-in items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors",
                  alert.acknowledged
                    ? "border-border/60 bg-surface/50"
                    : alert.severity === "critical"
                      ? "border-danger/30 bg-danger/[0.05]"
                      : alert.severity === "info"
                        ? "border-info/30 bg-info/[0.05]"
                        : "border-accent/30 bg-accent/[0.05]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1",
                    TONE_RING[meta.tone],
                  )}
                >
                  <Icon className="h-4.5 w-4.5" size={18} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">{alert.message}</span>
                    <Pill tone={meta.tone === "warn" ? "warn" : meta.tone} dot={false}>
                      {alertKindLabel(alert.kind)}
                    </Pill>
                    <Pill tone={severityTone} dot={false}>
                      {alertSeverityLabel(alert.severity)}
                    </Pill>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-muted">
                    <span className="tnum" title={alert.ts}>
                      {formatDateTime(alert.ts, branding.locale)} · {timeAgo(alert.ts, branding.locale)}
                    </span>
                    {alert.door_name && (
                      <span className="inline-flex items-center gap-1">
                        <DoorOpen className="h-3 w-3" /> {alert.door_name}
                      </span>
                    )}
                    {alert.member_name && <span>{alert.member_name}</span>}
                    {alert.acknowledged && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Check className="h-3 w-3" />
                        {t("alerts.acked")}
                        {alert.acknowledged_by_email
                          ? ` ${t("alerts.ackedBy", { email: alert.acknowledged_by_email })}`
                          : ""}
                      </span>
                    )}
                  </p>
                </div>

                {!alert.acknowledged && (
                  <button
                    type="button"
                    onClick={() => ack(alert)}
                    disabled={ackingId === alert.id}
                    className="btn-ghost inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary disabled:opacity-50"
                  >
                    {ackingId === alert.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {t("alerts.ack")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={ackAll}
        tone="primary"
        title={t("alerts.ackAll")}
        confirmLabel={t("alerts.ackAll.confirm")}
        description={<p>{t("alerts.ackAll.desc", { n: unackCount })}</p>}
      />
    </div>
  );
}
