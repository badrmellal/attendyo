"use client";

/**
 * ZoneDialog — create or edit a spatial zone (building / floor / area). Mirrors
 * the Console form language (Dialog shell, `.field` inputs, FormField). The
 * parent select excludes the zone itself and its descendants so the tree can
 * never form a cycle.
 *
 * Create → `createZone` (POST), edit → `updateZone` (PATCH). Both mutate the
 * in-memory store in MOCK mode so the demo works offline.
 */

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormField, FormError } from "./FormField";
import { useBranding } from "./BrandingProvider";
import { createZone, updateZone } from "@/lib/api";
import type { Zone, ZoneDraft, ZoneKind } from "@/lib/types";

const KINDS: ZoneKind[] = ["building", "floor", "area"];

type Form = {
  name: string;
  kind: ZoneKind;
  parent_id: string;
  capacity: string;
  energy_kw: string;
};

function toForm(zone: Zone | null): Form {
  if (!zone) return { name: "", kind: "building", parent_id: "", capacity: "", energy_kw: "" };
  return {
    name: zone.name,
    kind: zone.kind,
    parent_id: zone.parent_id ?? "",
    capacity: zone.capacity != null ? String(zone.capacity) : "",
    energy_kw: zone.energy_kw != null ? String(zone.energy_kw) : "",
  };
}

/** All zones that sit under `rootId` (so they can't be picked as its parent). */
function descendantsOf(rootId: string, zones: Zone[]): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const z of zones) {
      if (z.parent_id && out.has(z.parent_id) && !out.has(z.id)) {
        out.add(z.id);
        grew = true;
      }
    }
  }
  return out;
}

export function ZoneDialog({
  open,
  zone,
  zones,
  onClose,
  onSaved,
}: {
  open: boolean;
  zone: Zone | null;
  zones: Zone[];
  onClose: () => void;
  onSaved: (zone: Zone) => void;
}) {
  const { t } = useBranding();
  const isEdit = Boolean(zone);
  const [form, setForm] = useState<Form>(() => toForm(zone));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toForm(zone));
      setError(null);
      setSubmitting(false);
    }
  }, [open, zone]);

  // Candidate parents: every zone except self + its own descendants (no cycles).
  const parentOptions = useMemo(() => {
    const blocked = zone ? descendantsOf(zone.id, zones) : new Set<string>();
    return zones.filter((z) => !blocked.has(z.id));
  }, [zone, zones]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!form.name.trim()) {
      setError(t("zones.field.name") + " *");
      return;
    }
    const draft: ZoneDraft = {
      name: form.name.trim(),
      kind: form.kind,
      parent_id: form.parent_id || undefined,
      capacity: form.capacity.trim() ? Number(form.capacity) : undefined,
      energy_kw: form.energy_kw.trim() ? Number(form.energy_kw) : undefined,
    };
    setSubmitting(true);
    try {
      const saved = zone ? await updateZone(zone.id, draft) : await createZone(draft);
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
      title={isEdit ? t("zones.edit") : t("zones.add")}
      description={isEdit ? zone?.name : t("zones.subtitle")}
      size="md"
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
        <FormField label={t("zones.field.name")} required>
          <input
            className="field w-full px-3 py-2 text-sm"
            value={form.name}
            autoFocus
            onChange={(e) => set("name", e.target.value)}
            placeholder="ex. Bâtiment A"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("zones.field.kind")}>
            <select
              className="field w-full px-3 py-2 text-sm"
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as ZoneKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`zones.kind.${k}`)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t("zones.field.parent")}>
            <select
              className="field w-full px-3 py-2 text-sm"
              value={form.parent_id}
              onChange={(e) => set("parent_id", e.target.value)}
            >
              <option value="">{t("zones.parent.none")}</option>
              {parentOptions.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} · {t(`zones.kind.${z.kind}`)}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("zones.field.capacity")}>
            <input
              type="number"
              min={0}
              className="field tnum w-full px-3 py-2 text-sm"
              value={form.capacity}
              onChange={(e) => set("capacity", e.target.value)}
              placeholder="—"
            />
          </FormField>
          <FormField label={t("zones.field.energyKw")}>
            <input
              type="number"
              min={0}
              step="0.1"
              className="field tnum w-full px-3 py-2 text-sm"
              value={form.energy_kw}
              onChange={(e) => set("energy_kw", e.target.value)}
              placeholder="—"
            />
          </FormField>
        </div>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
