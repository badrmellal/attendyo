"use client";

/**
 * EnergyRuleDialog — create or edit an occupancy-driven energy rule. Same driver
 * family as doors (webhook | simulation). A webhook rule fires ON/OFF signals to
 * the buyer's own relay/BMS URL on their LAN; simulation only logs the toggles.
 *
 * Create → `createEnergyRule` (POST), edit → `updateEnergyRule` (PATCH). Mutates
 * the in-memory store in MOCK mode.
 */

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormField, FormError, Toggle } from "./FormField";
import { useBranding } from "./BrandingProvider";
import { createEnergyRule, updateEnergyRule } from "@/lib/api";
import type { EnergyDriver, EnergyRule, EnergyRuleDraft, Zone } from "@/lib/types";

const DRIVERS: EnergyDriver[] = ["simulation", "webhook"];
const HTTP_METHODS = ["POST", "GET", "PUT"];

type Form = {
  name: string;
  zone_id: string;
  empty_minutes: string;
  driver: EnergyDriver;
  enabled: boolean;
  webhook_url: string;
  webhook_method: string;
  webhook_on: string;
  webhook_off: string;
};

function toForm(rule: EnergyRule | null, zones: Zone[]): Form {
  if (!rule) {
    return {
      name: "",
      zone_id: zones[0]?.id ?? "",
      empty_minutes: "15",
      driver: "simulation",
      enabled: true,
      webhook_url: "",
      webhook_method: "POST",
      webhook_on: "1",
      webhook_off: "0",
    };
  }
  const cfg = rule.driver_config ?? {};
  return {
    name: rule.name,
    zone_id: rule.zone_id,
    empty_minutes: String(rule.empty_minutes ?? 15),
    driver: rule.driver,
    enabled: rule.enabled,
    webhook_url: typeof cfg.url === "string" ? cfg.url : "",
    webhook_method: typeof cfg.method === "string" ? cfg.method : "POST",
    webhook_on: cfg.on_on != null ? String(cfg.on_on) : "1",
    webhook_off: cfg.on_off != null ? String(cfg.on_off) : "0",
  };
}

function buildConfig(form: Form): Record<string, unknown> {
  if (form.driver === "webhook") {
    return {
      url: form.webhook_url.trim(),
      method: form.webhook_method,
      on_on: form.webhook_on,
      on_off: form.webhook_off,
    };
  }
  return {};
}

export function EnergyRuleDialog({
  open,
  rule,
  zones,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: EnergyRule | null;
  zones: Zone[];
  onClose: () => void;
  onSaved: (rule: EnergyRule) => void;
}) {
  const { t } = useBranding();
  const isEdit = Boolean(rule);
  const [form, setForm] = useState<Form>(() => toForm(rule, zones));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toForm(rule, zones));
      setError(null);
      setSubmitting(false);
    }
  }, [open, rule, zones]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!form.name.trim()) {
      setError(t("energy.field.name") + " *");
      return;
    }
    if (!form.zone_id) {
      setError(t("energy.field.zone") + " *");
      return;
    }
    if (form.driver === "webhook" && !form.webhook_url.trim()) {
      setError(t("energy.webhook.url") + " *");
      return;
    }
    const empty = Number(form.empty_minutes);
    if (!Number.isFinite(empty) || empty < 0) {
      setError(t("energy.field.emptyMinutes"));
      return;
    }
    const draft: EnergyRuleDraft = {
      name: form.name.trim(),
      zone_id: form.zone_id,
      empty_minutes: empty,
      driver: form.driver,
      driver_config: buildConfig(form),
      enabled: form.enabled,
    };
    setSubmitting(true);
    try {
      const saved = rule ? await updateEnergyRule(rule.id, draft) : await createEnergyRule(draft);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("energy.edit") : t("energy.add")}
      description={isEdit ? rule?.name : t("energy.subtitle")}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("energy.field.name")} required>
            <input
              className="field w-full px-3 py-2 text-sm"
              value={form.name}
              autoFocus
              onChange={(e) => set("name", e.target.value)}
              placeholder="ex. Éclairage Hall"
            />
          </FormField>
          <FormField label={t("energy.field.zone")} required>
            <select
              className="field w-full px-3 py-2 text-sm"
              value={form.zone_id}
              onChange={(e) => set("zone_id", e.target.value)}
            >
              {zones.length === 0 && <option value="">—</option>}
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("energy.field.emptyMinutes")}>
            <input
              type="number"
              min={0}
              className="field tnum w-full px-3 py-2 text-sm"
              value={form.empty_minutes}
              onChange={(e) => set("empty_minutes", e.target.value)}
              placeholder="15"
            />
          </FormField>
          <FormField label={t("energy.field.driver")}>
            <select
              className="field w-full px-3 py-2 text-sm"
              value={form.driver}
              onChange={(e) => set("driver", e.target.value as EnergyDriver)}
            >
              {DRIVERS.map((d) => (
                <option key={d} value={d}>
                  {t(`energy.driver.${d}`)}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {form.driver === "webhook" && (
          <div className="space-y-3 rounded-xl border border-border bg-surface-2/30 p-3">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <FormField label={t("energy.webhook.url")} required>
                <input
                  className="field w-full px-3 py-2 text-sm"
                  value={form.webhook_url}
                  onChange={(e) => set("webhook_url", e.target.value)}
                  placeholder="http://10.0.0.40/relay/lighting"
                />
              </FormField>
              <FormField label={t("energy.webhook.method")}>
                <select
                  className="field px-3 py-2 text-sm"
                  value={form.webhook_method}
                  onChange={(e) => set("webhook_method", e.target.value)}
                >
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("energy.webhook.onSignal")}>
                <input
                  className="field w-full px-3 py-2 text-sm"
                  value={form.webhook_on}
                  onChange={(e) => set("webhook_on", e.target.value)}
                  placeholder="1"
                />
              </FormField>
              <FormField label={t("energy.webhook.offSignal")}>
                <input
                  className="field w-full px-3 py-2 text-sm"
                  value={form.webhook_off}
                  onChange={(e) => set("webhook_off", e.target.value)}
                  placeholder="0"
                />
              </FormField>
            </div>
          </div>
        )}

        {form.driver === "simulation" && (
          <p className="rounded-xl border border-border bg-surface-2/30 px-3 py-2.5 text-xs text-text-muted">
            {t("energy.simulation.note")}
          </p>
        )}

        <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/30 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-text">{t("energy.field.enabled")}</p>
            <p className="text-xs text-text-muted">{t("energy.subtitle")}</p>
          </div>
          <Toggle
            checked={form.enabled}
            onChange={(v) => set("enabled", v)}
            label={t("energy.field.enabled")}
          />
        </div>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
