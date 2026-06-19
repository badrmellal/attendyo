"use client";

/**
 * CameraDialog — create or edit a camera bound to a door. Same Console form
 * language as the other dialogs. Thresholds are 0–1 (shown with their percent so
 * operators can reason about them). Create → `createCamera` (POST), edit →
 * `updateCamera` (PATCH).
 */

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormField, FormError, Toggle } from "./FormField";
import { createCamera, updateCamera } from "@/lib/api";
import type { Camera, CameraDraft, Door } from "@/lib/types";

type Form = {
  name: string;
  door_id: string;
  source: string;
  recognition_threshold: string;
  det_prob_threshold: string;
  enabled: boolean;
};

function toForm(camera: Camera | null, doors: Door[]): Form {
  if (!camera) {
    return {
      name: "",
      door_id: doors[0]?.id ?? "",
      source: "",
      recognition_threshold: "0.88",
      det_prob_threshold: "0.80",
      enabled: true,
    };
  }
  return {
    name: camera.name,
    door_id: camera.door_id ?? doors[0]?.id ?? "",
    source: camera.source ?? "",
    recognition_threshold: String(camera.recognition_threshold ?? 0.88),
    det_prob_threshold: String(camera.det_prob_threshold ?? 0.8),
    enabled: camera.enabled,
  };
}

function validThreshold(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

export function CameraDialog({
  open,
  camera,
  doors,
  onClose,
  onSaved,
}: {
  open: boolean;
  camera: Camera | null;
  doors: Door[];
  onClose: () => void;
  onSaved: (camera: Camera) => void;
}) {
  const isEdit = Boolean(camera);
  const [form, setForm] = useState<Form>(() => toForm(camera, doors));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toForm(camera, doors));
      setError(null);
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, camera]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!form.name.trim()) {
      setError("Le nom de la caméra est requis.");
      return;
    }
    const rec = validThreshold(form.recognition_threshold);
    if (rec == null) {
      setError("Le seuil de reconnaissance doit être compris entre 0 et 1.");
      return;
    }
    const det = validThreshold(form.det_prob_threshold);
    if (det == null) {
      setError("Le seuil de détection doit être compris entre 0 et 1.");
      return;
    }

    const draft: CameraDraft = {
      name: form.name.trim(),
      door_id: form.door_id || undefined,
      source: form.source.trim() || undefined,
      recognition_threshold: rec,
      det_prob_threshold: det,
      enabled: form.enabled,
    };

    setSubmitting(true);
    try {
      const saved = camera ? await updateCamera(camera.id, draft) : await createCamera(draft);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  const recPct = Math.round((validThreshold(form.recognition_threshold) ?? 0) * 100);
  const detPct = Math.round((validThreshold(form.det_prob_threshold) ?? 0) * 100);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Modifier la caméra" : "Ajouter une caméra"}
      description={isEdit ? camera?.name : "Liez une source vidéo à une porte."}
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
        <FormField label="Nom" required>
          <input
            className="field w-full px-3 py-2 text-sm"
            value={form.name}
            autoFocus
            onChange={(e) => set("name", e.target.value)}
            placeholder="ex. Cam Hall — Entrée"
          />
        </FormField>

        <FormField label="Porte">
          <select
            className="field w-full px-3 py-2 text-sm"
            value={form.door_id}
            onChange={(e) => set("door_id", e.target.value)}
          >
            <option value="">Aucune porte</option>
            {doors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Source" hint="URL RTSP ou index de périphérique USB (ex. « 0 »).">
          <input
            className="field w-full px-3 py-2 text-sm"
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            placeholder="rtsp://10.0.0.31:554/stream1"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Seuil de reconnaissance"
            hint={`Similarité min. pour accorder · ${recPct}%`}
          >
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              className="field tnum w-full px-3 py-2 text-sm"
              value={form.recognition_threshold}
              onChange={(e) => set("recognition_threshold", e.target.value)}
              placeholder="0.88"
            />
          </FormField>
          <FormField
            label="Seuil de détection"
            hint={`Probabilité min. du visage · ${detPct}%`}
          >
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              className="field tnum w-full px-3 py-2 text-sm"
              value={form.det_prob_threshold}
              onChange={(e) => set("det_prob_threshold", e.target.value)}
              placeholder="0.80"
            />
          </FormField>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/30 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-text">Caméra active</p>
            <p className="text-xs text-text-muted">Désactivée, elle ne traite aucun flux.</p>
          </div>
          <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label="Active" />
        </div>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
