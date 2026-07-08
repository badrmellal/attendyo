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
  Layers,
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
import { useBranding } from "@/components/BrandingProvider";
import {
  deleteCamera,
  deleteDoor,
  getZones,
  listCameras,
  listDoors,
  openDoor,
} from "@/lib/api";
import type { Camera, Door, Zone } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

// Driver names are proper nouns (Webhook / Pi GPIO / Simulation) — not localized.
const DRIVER_META: Record<Door["driver"], { icon: typeof Globe; label: string }> = {
  webhook: { icon: Globe, label: "Webhook" },
  pi_gpio: { icon: Cpu, label: "Pi GPIO" },
  simulation: { icon: FlaskConical, label: "Simulation" },
};

const DIRECTION_ICON: Record<Door["direction"], typeof ArrowDownUp> = {
  both: ArrowDownUp,
  in: ArrowDown,
  out: ArrowUp,
};

type PulseState = "idle" | "opening" | "open" | "error";

export default function DoorsPage() {
  const { branding, t } = useBranding();
  const [doors, setDoors] = useState<Door[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
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
    Promise.all([listDoors(), listCameras(), getZones()])
      .then(([d, c, z]) => {
        if (!active) return;
        setDoors(d);
        setCameras(c);
        setZones(z);
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
      header: t("cameras.col.name"),
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
      header: t("cameras.col.door"),
      cell: (c) => <span className="text-sm text-text-muted">{doorName(c.door_id)}</span>,
    },
    {
      key: "thresholds",
      header: t("cameras.col.thresholds"),
      cell: (c) => (
        <div className="space-y-0.5 text-xs text-text-muted">
          <p>
            {t("cameras.reco")}{" "}
            <span className="tnum text-text">
              {Math.round(Number(c.recognition_threshold) * 100)}%
            </span>
          </p>
          <p>
            {t("cameras.detection")}{" "}
            <span className="tnum text-text">
              {Math.round(Number(c.det_prob_threshold) * 100)}%
            </span>
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: t("people.col.status"),
      align: "right",
      cell: (c) => (
        <div className="flex justify-end">
          <Pill tone={c.enabled ? "ok" : "muted"} dot>
            {c.enabled ? t("doors.status.active") : t("doors.status.inactive")}
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
            label: t("common.edit"),
            icon: Pencil,
            onSelect: () => setCameraDialog({ open: true, camera: c }),
          },
          {
            label: t("common.delete"),
            icon: Trash2,
            tone: "danger",
            onSelect: () => setDeletingCamera(c),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowMenu actions={actions} label={t("people.rowActions", { name: c.name })} />
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
            {t("nav.doors")}
          </h2>
          <p className="text-sm text-text-muted tnum">
            {t("doors.count", {
              doors: formatNumber(doors.length, branding.locale),
              cameras: formatNumber(cameras.length, branding.locale),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDoorDialog({ open: true, door: null })}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          {t("doors.add")}
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
          title={t("doors.empty.title")}
          description={t("doors.empty.desc")}
          action={
            <button
              type="button"
              onClick={() => setDoorDialog({ open: true, door: null })}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="h-4 w-4" /> {t("doors.add")}
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {doors.map((door) => {
            const Driver = DRIVER_META[door.driver];
            const DirectionIcon = DIRECTION_ICON[door.direction];
            const directionLabel =
              door.direction === "both"
                ? `${t("dir.in")} / ${t("dir.out")}`
                : door.direction === "in"
                  ? t("dir.in")
                  : t("dir.out");
            const doorCameras = cameras.filter((c) => c.door_id === door.id);
            const state = pulse[door.id] ?? "idle";
            const opening = state === "opening";
            const opened = state === "open";

            const doorActions: RowAction[] = [
              {
                label: t("common.edit"),
                icon: Pencil,
                onSelect: () => setDoorDialog({ open: true, door }),
              },
              {
                label: t("common.delete"),
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
                    className="pointer-events-none absolute end-5 top-5 h-8 w-8 animate-pulse-ring rounded-full bg-primary/40"
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
                      {door.enabled ? t("doors.status.active") : t("doors.status.inactive")}
                    </Pill>
                    <RowMenu actions={doorActions} label={t("people.rowActions", { name: door.name })} />
                  </div>
                </div>

                {/* Metadata */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Meta icon={Driver.icon} label={Driver.label} />
                  <Meta icon={DirectionIcon} label={directionLabel} />
                  <Meta icon={Power} label={t("doors.relock", { n: door.relock_seconds })} />
                  {door.zone_id && (
                    <Meta
                      icon={Layers}
                      label={zones.find((z) => z.id === door.zone_id)?.name ?? "Zone"}
                    />
                  )}
                </div>

                {/* Cameras */}
                <div className="mt-4 space-y-1.5">
                  {doorCameras.length === 0 ? (
                    <p className="text-xs text-text-muted">{t("doors.noCamera")}</p>
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
                          {t("doors.threshold", {
                            n: Math.round(Number(cam.recognition_threshold) * 100),
                          })}
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
                        <Loader2 className="h-4 w-4 animate-spin" /> {t("doors.opening")}
                      </>
                    ) : opened ? (
                      <>
                        <Check className="h-4 w-4" /> {t("doors.opened")}
                      </>
                    ) : (
                      <>
                        <DoorOpen className="h-4 w-4" /> {t("doors.test")}
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
            {t("cameras.title")}
          </h3>
          <p className="text-sm text-text-muted">{t("cameras.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCameraDialog({ open: true, camera: null })}
          disabled={doors.length === 0}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {t("cameras.add")}
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
            title={t("cameras.empty.title")}
            description={
              doors.length === 0 ? t("cameras.empty.needDoor") : t("cameras.empty.desc")
            }
            action={
              doors.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCameraDialog({ open: true, camera: null })}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <Plus className="h-4 w-4" /> {t("cameras.add")}
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
        zones={zones}
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
        title={t("doors.delete.title")}
        confirmLabel={t("common.delete")}
        description={<p>{t("doors.delete.desc", { name: deletingDoor?.name ?? "" })}</p>}
      />

      <ConfirmDialog
        open={deletingCamera !== null}
        onClose={() => setDeletingCamera(null)}
        onConfirm={confirmDeleteCamera}
        title={t("cameras.delete.title")}
        confirmLabel={t("common.delete")}
        description={<p>{t("cameras.delete.desc", { name: deletingCamera?.name ?? "" })}</p>}
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
