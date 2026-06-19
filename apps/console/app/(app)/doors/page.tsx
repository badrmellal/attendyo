"use client";

/**
 * Doors & cameras — list controlled passages and their bound cameras. Each door
 * has a "Test open" button that POSTs /api/doors/{id}/open and shows an ultramarine
 * pulse on success. Drivers (webhook / pi_gpio / simulation) and directions are
 * surfaced as quiet metadata.
 */

import { useEffect, useState } from "react";
import {
  DoorOpen,
  DoorClosed,
  Webcam,
  Cpu,
  Globe,
  FlaskConical,
  ArrowDownUp,
  ArrowDown,
  ArrowUp,
  Loader2,
  Check,
  Power,
  MapPin,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Pill } from "@/components/StatusPill";
import { listCameras, listDoors, openDoor } from "@/lib/api";
import type { Camera, Door } from "@/lib/types";
import { cn } from "@/lib/utils";

const DRIVER_META: Record<Door["driver"], { icon: typeof Globe; label: string }> = {
  webhook: { icon: Globe, label: "Webhook" },
  pi_gpio: { icon: Cpu, label: "Pi GPIO" },
  simulation: { icon: FlaskConical, label: "Simulation" },
};

const DIRECTION_META: Record<Door["direction"], { icon: typeof ArrowDownUp; label: string }> = {
  both: { icon: ArrowDownUp, label: "Entrée / Sortie" },
  in: { icon: ArrowDown, label: "Entrée" },
  out: { icon: ArrowUp, label: "Sortie" },
};

type PulseState = "idle" | "opening" | "open" | "error";

export default function DoorsPage() {
  const [doors, setDoors] = useState<Door[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState<Record<string, PulseState>>({});

  useEffect(() => {
    let active = true;
    Promise.all([listDoors(), listCameras()])
      .then(([d, c]) => {
        if (!active) return;
        setDoors(d);
        setCameras(c);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function test(door: Door) {
    setPulse((p) => ({ ...p, [door.id]: "opening" }));
    try {
      const res = await openDoor(door.id);
      setPulse((p) => ({ ...p, [door.id]: res.ok ? "open" : "error" }));
    } catch {
      setPulse((p) => ({ ...p, [door.id]: "error" }));
    } finally {
      setTimeout(() => setPulse((p) => ({ ...p, [door.id]: "idle" })), 2200);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-56 p-5">
            <div className="skeleton mb-4 h-6 w-1/2" />
            <div className="skeleton mb-2 h-4 w-3/4" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (doors.length === 0) {
    return (
      <EmptyState
        icon={DoorClosed}
        title="Aucune porte configurée"
        description="Ajoutez une porte et liez une caméra pour commencer le contrôle d'accès."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight text-text">
          Portes & caméras
        </h2>
        <p className="text-sm text-text-muted">
          <span className="tnum font-medium text-text">{doors.length}</span> portes ·{" "}
          <span className="tnum font-medium text-text">{cameras.length}</span> caméras
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {doors.map((door) => {
          const Driver = DRIVER_META[door.driver];
          const Direction = DIRECTION_META[door.direction];
          const doorCameras = cameras.filter((c) => c.door_id === door.id);
          const state = pulse[door.id] ?? "idle";
          const opening = state === "opening";
          const opened = state === "open";

          return (
            <div
              key={door.id}
              className={cn(
                "card relative flex flex-col overflow-hidden p-5 transition-shadow duration-200",
                opened && "shadow-glow",
              )}
            >
              {/* door-open pulse */}
              {opened && (
                <span
                  className="pointer-events-none absolute right-5 top-5 h-8 w-8 animate-pulse-ring rounded-full bg-primary/40"
                  aria-hidden
                />
              )}

              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl ring-1",
                      door.enabled
                        ? "bg-primary/10 text-primary ring-primary/20"
                        : "bg-surface-2 text-text-muted ring-border",
                    )}
                  >
                    {opened ? (
                      <DoorOpen className="h-5 w-5" />
                    ) : door.enabled ? (
                      <DoorClosed className="h-5 w-5" />
                    ) : (
                      <Power className="h-5 w-5" />
                    )}
                  </span>
                  <div>
                    <h3 className="font-display font-semibold text-text">{door.name}</h3>
                    {door.location && (
                      <p className="flex items-center gap-1 text-xs text-text-muted">
                        <MapPin className="h-3 w-3" /> {door.location}
                      </p>
                    )}
                  </div>
                </div>
                <Pill tone={door.enabled ? "ok" : "muted"} dot>
                  {door.enabled ? "Active" : "Inactive"}
                </Pill>
              </div>

              {/* Metadata */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Meta icon={Driver.icon} label={Driver.label} />
                <Meta icon={Direction.icon} label={Direction.label} />
                <Meta icon={Power} label={`Relock ${door.relock_seconds}s`} />
              </div>

              {/* Cameras */}
              <div className="mt-4 space-y-1.5">
                {doorCameras.length === 0 ? (
                  <p className="text-xs text-text-muted">Aucune caméra liée</p>
                ) : (
                  doorCameras.map((cam) => (
                    <div
                      key={cam.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-surface-2/30 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Webcam className="h-3.5 w-3.5 text-text-muted" />
                        <span className="text-sm text-text">{cam.name}</span>
                      </div>
                      <span className="tnum text-xs text-text-muted">
                        seuil {Math.round(Number(cam.recognition_threshold) * 100)}%
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Test open */}
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={() => test(door)}
                  disabled={!door.enabled || opening}
                  className={cn(
                    "inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all duration-200",
                    opened
                      ? "bg-primary/15 text-primary"
                      : "btn-ghost hover:border-primary/40 hover:text-primary",
                    (!door.enabled || opening) && "opacity-60",
                  )}
                >
                  {opening ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Ouverture…
                    </>
                  ) : opened ? (
                    <>
                      <Check className="h-4 w-4" /> Ouverte
                    </>
                  ) : (
                    <>
                      <DoorOpen className="h-4 w-4" /> Tester l'ouverture
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Meta({ icon: Icon, label }: { icon: typeof Globe; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2/40 px-2 py-1 text-xs text-text-muted">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
