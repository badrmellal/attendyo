"use client";

/**
 * DoorDialog — create or edit a controlled passage. Mirrors the Console form
 * language (Dialog shell, `.field` inputs, `.btn-primary`/`.btn-ghost`).
 *
 * `driver_config` is edited through conditional fields per driver:
 *   webhook    → url + method
 *   pi_gpio    → pin + active_high
 *   simulation → none
 * Create → `createDoor` (POST), edit → `updateDoor` (PATCH).
 */

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormField, FormError, Toggle } from "./FormField";
import { createDoor, updateDoor } from "@/lib/api";
import type { Door, DoorDirection, DoorDraft, DoorDriver } from "@/lib/types";

const DRIVERS: { value: DoorDriver; label: string }[] = [
  { value: "webhook", label: "Webhook" },
  { value: "pi_gpio", label: "Raspberry Pi GPIO" },
  { value: "simulation", label: "Simulation" },
];

const DIRECTIONS: { value: DoorDirection; label: string }[] = [
  { value: "both", label: "Entrée / Sortie" },
  { value: "in", label: "Entrée" },
  { value: "out", label: "Sortie" },
];

const HTTP_METHODS = ["POST", "GET", "PUT"];

type Form = {
  name: string;
  location: string;
  direction: DoorDirection;
  driver: DoorDriver;
  relock_seconds: string;
  enabled: boolean;
  // driver_config fields
  webhook_url: string;
  webhook_method: string;
  gpio_pin: string;
  gpio_active_high: boolean;
};

const EMPTY: Form = {
  name: "",
  location: "",
  direction: "both",
  driver: "simulation",
  relock_seconds: "5",
  enabled: true,
  webhook_url: "",
  webhook_method: "POST",
  gpio_pin: "17",
  gpio_active_high: true,
};

function toForm(door: Door | null): Form {
  if (!door) return { ...EMPTY };
  const cfg = door.driver_config ?? {};
  return {
    name: door.name,
    location: door.location ?? "",
    direction: door.direction,
    driver: door.driver,
    relock_seconds: String(door.relock_seconds ?? 5),
    enabled: door.enabled,
    webhook_url: typeof cfg.url === "string" ? cfg.url : "",
    webhook_method: typeof cfg.method === "string" ? cfg.method : "POST",
    gpio_pin: cfg.pin != null ? String(cfg.pin) : "17",
    gpio_active_high: cfg.active_high !== false,
  };
}

function buildConfig(form: Form): Record<string, unknown> {
  if (form.driver === "webhook") {
    return { url: form.webhook_url.trim(), method: form.webhook_method };
  }
  if (form.driver === "pi_gpio") {
    return { pin: Number(form.gpio_pin) || 0, active_high: form.gpio_active_high };
  }
  return {};
}

export function DoorDialog({
  open,
  door,
  onClose,
  onSaved,
}: {
  open: boolean;
  door: Door | null;
  onClose: () => void;
  onSaved: (door: Door) => void;
}) {
  const isEdit = Boolean(door);
  const [form, setForm] = useState<Form>(() => toForm(door));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toForm(door));
      setError(null);
      setSubmitting(false);
    }
  }, [open, door]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!form.name.trim()) {
      setError("Le nom de la porte est requis.");
      return;
    }
    if (form.driver === "webhook" && !form.webhook_url.trim()) {
      setError("L'URL du webhook est requise.");
      return;
    }
    if (form.driver === "pi_gpio" && !form.gpio_pin.trim()) {
      setError("Le numéro de broche GPIO est requis.");
      return;
    }
    const relock = Number(form.relock_seconds);
    if (!Number.isFinite(relock) || relock < 0) {
      setError("Le délai de reverrouillage doit être un nombre positif.");
      return;
    }

    const draft: DoorDraft = {
      name: form.name.trim(),
      location: form.location.trim() || undefined,
      direction: form.direction,
      driver: form.driver,
      driver_config: buildConfig(form),
      relock_seconds: relock,
      enabled: form.enabled,
    };

    setSubmitting(true);
    try {
      const saved = door ? await updateDoor(door.id, draft) : await createDoor(draft);
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
      title={isEdit ? "Modifier la porte" : "Ajouter une porte"}
      description={
        isEdit ? door?.name : "Configurez un passage contrôlé et son pilote d'ouverture."
      }
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>
            Annuler
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
            {isEdit ? "Enregistrer" : "Ajouter"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Nom" required>
            <input
              className="field w-full px-3 py-2 text-sm"
              value={form.name}
              autoFocus
              onChange={(e) => set("name", e.target.value)}
              placeholder="ex. Entrée Principale"
            />
          </FormField>
          <FormField label="Emplacement">
            <input
              className="field w-full px-3 py-2 text-sm"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="ex. Rez-de-chaussée — Hall"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Direction">
            <select
              className="field w-full px-3 py-2 text-sm"
              value={form.direction}
              onChange={(e) => set("direction", e.target.value as DoorDirection)}
            >
              {DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Reverrouillage (secondes)">
            <input
              type="number"
              min={0}
              className="field tnum w-full px-3 py-2 text-sm"
              value={form.relock_seconds}
              onChange={(e) => set("relock_seconds", e.target.value)}
              placeholder="5"
            />
          </FormField>
        </div>

        <FormField label="Pilote d'ouverture">
          <select
            className="field w-full px-3 py-2 text-sm"
            value={form.driver}
            onChange={(e) => set("driver", e.target.value as DoorDriver)}
          >
            {DRIVERS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </FormField>

        {/* Conditional driver_config */}
        {form.driver === "webhook" && (
          <div className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-border bg-surface-2/30 p-3">
            <FormField label="URL du webhook" required>
              <input
                className="field w-full px-3 py-2 text-sm"
                value={form.webhook_url}
                onChange={(e) => set("webhook_url", e.target.value)}
                placeholder="http://10.0.0.20/relay"
              />
            </FormField>
            <FormField label="Méthode">
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
        )}

        {form.driver === "pi_gpio" && (
          <div className="flex items-end gap-4 rounded-xl border border-border bg-surface-2/30 p-3">
            <FormField label="Broche (pin)" required className="w-32">
              <input
                type="number"
                min={0}
                className="field tnum w-full px-3 py-2 text-sm"
                value={form.gpio_pin}
                onChange={(e) => set("gpio_pin", e.target.value)}
                placeholder="17"
              />
            </FormField>
            <div className="flex items-center gap-2.5 pb-2">
              <Toggle
                checked={form.gpio_active_high}
                onChange={(v) => set("gpio_active_high", v)}
                label="Active haut"
              />
              <span className="text-sm text-text">Active haut (active_high)</span>
            </div>
          </div>
        )}

        {form.driver === "simulation" && (
          <p className="rounded-xl border border-border bg-surface-2/30 px-3 py-2.5 text-xs text-text-muted">
            La simulation n'a aucune configuration — elle journalise et notifie l'écran du
            portail (Gate) sans piloter de matériel.
          </p>
        )}

        <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/30 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-text">Porte active</p>
            <p className="text-xs text-text-muted">
              Désactivée, la porte n'ouvre pas et le test est bloqué.
            </p>
          </div>
          <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label="Active" />
        </div>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
