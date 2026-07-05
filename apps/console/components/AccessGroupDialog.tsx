"use client";

/**
 * AccessGroupDialog — create / edit an access group (`/api/access-groups`).
 *
 * A group = a name + the doors it opens + an optional weekly schedule.
 * Per the contract: `door_ids` empty ⇒ ALL doors; `schedule` `{}` ⇒ ANY time.
 * The UI models that faithfully: a "Toujours autorisé" toggle maps to `{}`,
 * otherwise each weekday carries an optional [start, end] window (a day left
 * unchecked = closed that day).
 */

import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormField, FormError, Toggle } from "./FormField";
import { createAccessGroup, updateAccessGroup } from "@/lib/api";
import type { AccessGroup, Door, Schedule, ScheduleDay } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS: { key: ScheduleDay; label: string }[] = [
  { key: "mon", label: "Lundi" },
  { key: "tue", label: "Mardi" },
  { key: "wed", label: "Mercredi" },
  { key: "thu", label: "Jeudi" },
  { key: "fri", label: "Vendredi" },
  { key: "sat", label: "Samedi" },
  { key: "sun", label: "Dimanche" },
];

type DayRow = { enabled: boolean; start: string; end: string };
type DayState = Record<ScheduleDay, DayRow>;

const DEFAULT_ROW: DayRow = { enabled: false, start: "08:00", end: "18:00" };

function scheduleToState(schedule: Schedule): DayState {
  const state = {} as DayState;
  for (const { key } of DAYS) {
    const window = schedule[key];
    state[key] = window
      ? { enabled: true, start: window[0], end: window[1] }
      : { ...DEFAULT_ROW };
  }
  return state;
}

function stateToSchedule(state: DayState): Schedule {
  const schedule: Schedule = {};
  for (const { key } of DAYS) {
    const row = state[key];
    if (row.enabled) schedule[key] = [row.start, row.end];
  }
  return schedule;
}

export function AccessGroupDialog({
  open,
  group,
  doors,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create. */
  group: AccessGroup | null;
  doors: Door[];
  onClose: () => void;
  onSaved: (group: AccessGroup) => void;
}) {
  const [name, setName] = useState("");
  const [doorIds, setDoorIds] = useState<string[]>([]);
  const [always, setAlways] = useState(true);
  const [days, setDays] = useState<DayState>(scheduleToState({}));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)hydrate whenever the dialog opens on a different group.
  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setDoorIds(group?.door_ids ? [...group.door_ids] : []);
    const schedule = group?.schedule ?? {};
    const isAlways = Object.keys(schedule).length === 0;
    setAlways(isAlways);
    setDays(scheduleToState(schedule));
    setError(null);
    setSubmitting(false);
  }, [open, group]);

  function toggleDoor(id: string) {
    setDoorIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  function patchDay(key: ScheduleDay, patch: Partial<DayRow>) {
    setDays((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Le nom du groupe est requis.");
      return;
    }
    const schedule = always ? {} : stateToSchedule(days);
    if (!always) {
      if (Object.keys(schedule).length === 0) {
        setError("Activez au moins un jour, ou repassez en « Toujours autorisé ».");
        return;
      }
      for (const { key, label } of DAYS) {
        const row = days[key];
        if (row.enabled && (!row.start || !row.end || row.start >= row.end)) {
          setError(`${label} : l'heure de début doit précéder l'heure de fin.`);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      const draft = { name: name.trim(), door_ids: doorIds, schedule };
      const saved = group
        ? await updateAccessGroup(group.id, draft)
        : await createAccessGroup(draft);
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
      title={group ? "Modifier le groupe d'accès" : "Nouveau groupe d'accès"}
      description={group?.name}
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
            Enregistrer
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Nom du groupe" required>
          <input
            className="field w-full px-3 py-2 text-sm"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Employés — Bureaux"
          />
        </FormField>

        <FormField
          label="Portes autorisées"
          hint={
            doorIds.length === 0
              ? "Aucune porte sélectionnée = toutes les portes."
              : `${doorIds.length} porte(s) sélectionnée(s).`
          }
        >
          <div className="flex flex-wrap gap-2">
            {doors.map((door) => {
              const selected = doorIds.includes(door.id);
              return (
                <button
                  key={door.id}
                  type="button"
                  onClick={() => toggleDoor(door.id)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-surface-2/40 text-text-muted hover:text-text",
                  )}
                >
                  {door.name}
                </button>
              );
            })}
            {doors.length === 0 && (
              <p className="text-xs text-text-muted">
                Aucune porte configurée — le groupe ouvrira toutes les portes futures.
              </p>
            )}
          </div>
        </FormField>

        {/* Schedule */}
        <div className="rounded-xl border border-border bg-surface-2/20 p-4">
          <label className="flex cursor-pointer items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">Toujours autorisé</p>
              <p className="text-xs text-text-muted">
                Sans restriction horaire — sinon, définissez des fenêtres par jour.
              </p>
            </div>
            <Toggle checked={always} onChange={setAlways} label="Toujours autorisé" />
          </label>

          {!always && (
            <div className="mt-4 space-y-2">
              {DAYS.map(({ key, label }) => {
                const row = days[key];
                return (
                  <div
                    key={key}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                      row.enabled ? "border-primary/25 bg-primary/[0.04]" : "border-border/60",
                    )}
                  >
                    <label className="flex w-28 shrink-0 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => patchDay(key, { enabled: e.target.checked })}
                        className="h-4 w-4 accent-[rgb(var(--primary))]"
                      />
                      <span
                        className={cn(
                          "text-sm",
                          row.enabled ? "font-medium text-text" : "text-text-muted",
                        )}
                      >
                        {label}
                      </span>
                    </label>
                    {row.enabled ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={row.start}
                          onChange={(e) => patchDay(key, { start: e.target.value })}
                          className="field tnum px-2.5 py-1.5 text-sm"
                          aria-label={`${label} — début`}
                        />
                        <span className="text-text-muted">→</span>
                        <input
                          type="time"
                          value={row.end}
                          onChange={(e) => patchDay(key, { end: e.target.value })}
                          className="field tnum px-2.5 py-1.5 text-sm"
                          aria-label={`${label} — fin`}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-text-muted">Fermé</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
