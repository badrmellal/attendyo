"use client";

/**
 * Doors & cameras — manage controlled passages and the cameras bound to them.
 *
 * Doors: add / edit / delete, plus the existing "Test open" pulse
 * (POST /api/doors/{id}/open). Cameras are listed below in their own table with
 * add / edit / delete. All deletes go through a confirm dialog; all create/edit
 * use the shared Console form dialogs. Everything mutates in MOCK mode offline.
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
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Pill } from "@/components/StatusPill";
import { DataTable, type Column } from "@/components/DataTable";
import { RowMenu, type RowAction } from "@/components/RowMenu";
import { DoorDialog } from "@/components/DoorDialog";
import { CameraDialog } from "@/components/CameraDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  deleteCamera,
  deleteDoor,
  listCameras,
  listDoors,
  openDoor,
} from "@/lib/api";
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

  // Dialog state
  const [doorDialog, setDoorDialog] = useState<{ open: boolean; door: Door | null }>({
    open: false,
    door: null,
  });
  const [cameraDialog, setCameraDialog] = useState<{ open: boolean; camera: Camera | null }>({
    open: false,
    camera: null,
  });
  const [deletingDoor, setDeletingDoor] = useState<Door | null>(null);
  const [deletingCamera, setDeletingCamera] = useState<Camera | null>(null);

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

  function onDoorSaved(saved: Door) {
    setDoors((prev) =>
      prev.some((d) => d.id === saved.id)
        ? prev.map((d) => (d.id === saved.id ? saved : d))
        : [...prev, saved],
    );
  }

  function onCameraSaved(saved: Camera) {
    setCameras((prev) =>
      prev.some((c) => c.id === saved.id)
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [...prev, saved],
    );
  }

  async function confirmDeleteDoor() {
    if (!deletingDoor) return;
    const id = deletingDoor.id;
    await deleteDoor(id);
    setDoors((prev) => prev.filter((d) => d.id !== id));
    // Cameras cascade with the door (schema ON DELETE CASCADE).
    setCameras((prev) => prev.filter((c) => c.door_id !== id));
  }

  async function confirmDeleteCamera() {
    if (!deletingCamera) return;
    const id = deletingCamera.id;
    await deleteCamera(id);
    setCameras((prev) => prev.filter((c) => c.id !== id));
  }

  const doorName = (id?: string) => doors.find((d) => d.id === id)?.name ?? "—";

  const cameraColumns: Column<Camera>[] = [
    {
      key: "name",
      header: "Caméra",
      cell: (c) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2/60 text-text-muted ring-1 ring-border">
            <Webcam className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{c.name}</p>
            {c.source && (
              <p className="truncate text-xs text-text-muted">{c.source}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "door",
      header: "Porte",
      cell: (c) => <span className="text-sm text-text-muted">{doorName(c.door_id)}</span>,
    },
    {
      key: "thresholds",
      header: "Seuils",
      cell: (c) => (
        <div className="space-y-0.5 text-xs text-text-muted">
          <p>
            Reco{" "}
            <span className="tnum text-text">
              {Math.round(Number(c.recognition_threshold) * 100)}%
            </span>
          </p>
          <p>
            Détection{" "}
            <span className="tnum text-text">
              {Math.round(Number(c.det_prob_threshold) * 100)}%
            </span>
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Statut",
      align: "right",
      cell: (c) => (
        <div className="flex justify-end">
          <Pill tone={c.enabled ? "ok" : "muted"} dot>
            {c.enabled ? "Active" : "Inactive"}
          </Pill>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      cell: (c) => {
        const actions: RowAction[] = [
          {
            label: "Modifier",
            icon: Pencil,
            onSelect: () => setCameraDialog({ open: true, camera: c }),
          },
          {
            label: "Supprimer",
            icon: Trash2,
            tone: "danger",
            onSelect: () => setDeletingCamera(c),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowMenu actions={actions} label={`Actions pour ${c.name}`} />
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">
            Portes & caméras
          </h2>
          <p className="text-sm text-text-muted">
            <span className="tnum font-medium text-text">{doors.length}</span> portes ·{" "}
            <span className="tnum font-medium text-text">{cameras.length}</span> caméras
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDoorDialog({ open: true, door: null })}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          Ajouter une porte
        </button>
      </div>

      {/* Doors grid / skeleton / empty */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-56 p-5">
              <div className="skeleton mb-4 h-6 w-1/2" />
              <div className="skeleton mb-2 h-4 w-3/4" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : doors.length === 0 ? (
        <EmptyState
          icon={DoorClosed}
          title="Aucune porte configurée"
          description="Ajoutez une porte et liez une caméra pour commencer le contrôle d'accès."
          action={
            <button
              type="button"
              onClick={() => setDoorDialog({ open: true, door: null })}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="h-4 w-4" /> Ajouter une porte
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {doors.map((door) => {
            const Driver = DRIVER_META[door.driver];
            const Direction = DIRECTION_META[door.direction];
            const doorCameras = cameras.filter((c) => c.door_id === door.id);
            const state = pulse[door.id] ?? "idle";
            const opening = state === "opening";
            const opened = state === "open";

            const doorActions: RowAction[] = [
              {
                label: "Modifier",
                icon: Pencil,
                onSelect: () => setDoorDialog({ open: true, door }),
              },
              {
                label: "Supprimer",
                icon: Trash2,
                tone: "danger",
                onSelect: () => setDeletingDoor(door),
              },
            ];

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
                  <div className="flex items-center gap-1">
                    <Pill tone={door.enabled ? "ok" : "muted"} dot>
                      {door.enabled ? "Active" : "Inactive"}
                    </Pill>
                    <RowMenu actions={doorActions} label={`Actions pour ${door.name}`} />
                  </div>
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
      )}

      {/* Cameras table */}
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold tracking-tight text-text">
            Caméras
          </h3>
          <p className="text-sm text-text-muted">Sources vidéo liées aux portes.</p>
        </div>
        <button
          type="button"
          onClick={() => setCameraDialog({ open: true, camera: null })}
          disabled={doors.length === 0}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Ajouter une caméra
        </button>
      </div>

      <DataTable
        columns={cameraColumns}
        rows={cameras}
        rowKey={(c) => c.id}
        loading={loading}
        skeletonRows={3}
        empty={
          <EmptyState
            icon={Webcam}
            title="Aucune caméra"
            description={
              doors.length === 0
                ? "Ajoutez d'abord une porte, puis liez-y une caméra."
                : "Ajoutez une caméra et liez-la à une porte."
            }
            action={
              doors.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCameraDialog({ open: true, camera: null })}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <Plus className="h-4 w-4" /> Ajouter une caméra
                </button>
              ) : undefined
            }
          />
        }
      />

      {/* Dialogs */}
      <DoorDialog
        open={doorDialog.open}
        door={doorDialog.door}
        onClose={() => setDoorDialog({ open: false, door: null })}
        onSaved={onDoorSaved}
      />

      <CameraDialog
        open={cameraDialog.open}
        camera={cameraDialog.camera}
        doors={doors}
        onClose={() => setCameraDialog({ open: false, camera: null })}
        onSaved={onCameraSaved}
      />

      <ConfirmDialog
        open={deletingDoor !== null}
        onClose={() => setDeletingDoor(null)}
        onConfirm={confirmDeleteDoor}
        title="Supprimer la porte"
        confirmLabel="Supprimer"
        description={
          <p>
            Supprimer <span className="font-medium text-text">{deletingDoor?.name}</span> ? Les
            caméras liées seront aussi supprimées. Cette action est irréversible.
          </p>
        }
      />

      <ConfirmDialog
        open={deletingCamera !== null}
        onClose={() => setDeletingCamera(null)}
        onConfirm={confirmDeleteCamera}
        title="Supprimer la caméra"
        confirmLabel="Supprimer"
        description={
          <p>
            Supprimer <span className="font-medium text-text">{deletingCamera?.name}</span> ?
            Cette action est irréversible.
          </p>
        }
      />
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
