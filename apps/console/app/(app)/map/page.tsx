"use client";

/**
 * Live Map — the zone-level digital twin (v3 "Spatial Intelligence").
 *
 * An isometric SVG of the zone tree, auto-laid-out from the zone list (no
 * floor-plan upload): buildings become towers, floors/areas become stacked
 * slabs. Live dots = one per on-site person, grouped into their current zone and
 * gently drifting within the slab (never implying desk-level precision). Slabs
 * tint by occupancy vs capacity (ultramarine → gold → rose, colourblind-safe:
 * the count is always shown) and flag congestion. Hover a zone for its count +
 * first names. An emergency toggle switches to a stark evacuation view.
 *
 * Data: GET /api/zones + GET /api/zones/occupancy + GET /api/presence/now, kept
 * live by the SSE `access` stream (debounced refetch on each granted event).
 * Everything is themed from branding tokens and fully localized (fr/en/ar).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, Map as MapIcon, Radio, Users } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useBranding } from "@/components/BrandingProvider";
import { getPresenceNow, getZoneOccupancy, getZones, streamEvents } from "@/lib/api";
import type { AccessEvent, PresencePerson, Zone, ZoneOccupancy } from "@/lib/types";
import { cn } from "@/lib/utils";

// --- isometric geometry (all in SVG units) --------------------------------
const SLAB_HW = 118; // top-face half-width
const SLAB_HH = 30; // top-face half-height (≈2:1 iso)
const SLAB_T = 14; // slab thickness (the 3D side)
const ROW_STEP = 60; // vertical distance between stacked slab centres
const FLOOR_GAP = 30; // headroom above a floor group (holds the floor label)
const PAD_X = 26;
const PAD_TOP = 14;
const PAD_BOTTOM = 64; // room for the building plinth beneath the lowest slab
const SVG_W = SLAB_HW * 2 + PAD_X * 2;
const CX = SVG_W / 2;
const MAX_TOOLTIP_NAMES = 6;

type Tone = "empty" | "primary" | "accent" | "danger";

type Slab = {
  zone: Zone;
  count: number;
  capacity?: number;
  congested: boolean;
  people: PresencePerson[];
};
type FloorRow = { label?: string; labelY: number; slabs: { slab: Slab; cy: number }[] };
type BuildingVM = { zone: Zone; total: number; congested: boolean; rows: FloorRow[]; height: number };

type HoverInfo = { name: string; count: number; capacity?: number; names: string[]; x: number; y: number };

// --- pure helpers ----------------------------------------------------------
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295; // 0..1
}
const frac = (x: number) => x - Math.floor(x);

function occTone(count: number, capacity?: number): Tone {
  if (count === 0) return "empty";
  if (capacity == null || capacity <= 0) return "primary";
  const r = count / capacity;
  if (r < 0.5) return "primary";
  if (r < 0.85) return "accent";
  return "danger";
}

/** Congestion flag per contract: entries/15min > max(5, capacity/4). */
function isCongested(congestion: number, capacity?: number): boolean {
  return congestion > Math.max(5, capacity ? capacity / 4 : 0);
}

function toneVars(tone: Tone): { top: string; stroke: string; left: string; right: string; solid: string } {
  if (tone === "empty") {
    return {
      top: "rgb(var(--surface-2) / 0.5)",
      stroke: "rgb(var(--border))",
      left: "rgb(var(--surface-2) / 0.85)",
      right: "rgb(var(--surface) / 0.95)",
      solid: "rgb(var(--text-muted))",
    };
  }
  const v = tone === "primary" ? "--primary" : tone === "accent" ? "--accent" : "--danger";
  return {
    top: `rgb(var(${v}) / 0.24)`,
    stroke: `rgb(var(${v}) / 0.6)`,
    left: `rgb(var(${v}) / 0.34)`,
    right: `rgb(var(${v}) / 0.18)`,
    solid: `rgb(var(${v}))`,
  };
}

// Slab face paths, anchored on the top-face centre (cx, cy).
const topPath = (cx: number, cy: number) =>
  `M${cx},${cy - SLAB_HH} L${cx + SLAB_HW},${cy} L${cx},${cy + SLAB_HH} L${cx - SLAB_HW},${cy} Z`;
const leftPath = (cx: number, cy: number) =>
  `M${cx - SLAB_HW},${cy} L${cx},${cy + SLAB_HH} L${cx},${cy + SLAB_HH + SLAB_T} L${cx - SLAB_HW},${cy + SLAB_T} Z`;
const rightPath = (cx: number, cy: number) =>
  `M${cx + SLAB_HW},${cy} L${cx},${cy + SLAB_HH} L${cx},${cy + SLAB_HH + SLAB_T} L${cx + SLAB_HW},${cy + SLAB_T} Z`;
const silhouette = (cx: number, cy: number) =>
  [
    [cx, cy - SLAB_HH],
    [cx + SLAB_HW, cy],
    [cx + SLAB_HW, cy + SLAB_T],
    [cx, cy + SLAB_HH + SLAB_T],
    [cx - SLAB_HW, cy + SLAB_T],
    [cx - SLAB_HW, cy],
  ]
    .map((p) => p.join(","))
    .join(" ");

/** A person dot's position inside the top rhombus, biased right of the labels. */
function dotAt(seed: number, cx: number, cy: number) {
  let a = frac(seed * 6.1803398875) * 2 - 1;
  let b = frac(seed * 3.7548776662) * 2 - 1;
  if (Math.abs(a) + Math.abs(b) > 1) {
    // fold back into the rhombus
    a = Math.sign(a) * (1 - Math.abs(b));
  }
  return { x: cx + (a * 0.42 + 0.22) * SLAB_HW, y: cy - SLAB_HH * 0.18 + b * SLAB_HH * 0.52 };
}

const shortName = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Deterministic floor-elevation heuristic from the floor name, so the tower
 * stacks physically (upper storeys on top) without an elevation field on the
 * zone. Unknown names fall back to their zone-list order.
 */
function floorElevation(name: string, index: number): number {
  const n = name.toLowerCase();
  if (/sous-?sol|parking|basement|niveau\s*-|(^|\D)-\d/.test(n)) return -10 + index * 0.001;
  if (/rdc|rez|ground|niveau\s*0/.test(n)) return index * 0.001;
  const m =
    n.match(/(\d+)\s*(?:er|e|ème|eme|st|nd|rd|th)?\s*(?:étage|etage|floor|niveau)/) ||
    n.match(/(?:étage|etage|floor|niveau)\s*(\d+)/) ||
    n.match(/(\d+)/);
  return m ? parseInt(m[1], 10) + index * 0.001 : index * 0.001;
}

/** Build the ordered, positioned view-model for one building. */
function buildBuilding(
  building: Zone,
  zones: Zone[],
  occById: Map<string, ZoneOccupancy>,
  peopleByZone: Map<string, PresencePerson[]>,
): BuildingVM {
  const childrenOf = (id: string, kind?: Zone["kind"]) =>
    zones.filter((z) => z.parent_id === id && (kind ? z.kind === kind : true));

  const makeSlab = (zone: Zone): Slab => {
    const occ = occById.get(zone.id);
    const count = occ?.count ?? 0;
    return {
      zone,
      count,
      capacity: zone.capacity,
      congested: isCongested(occ?.congestion ?? 0, zone.capacity),
      people: peopleByZone.get(zone.id) ?? [],
    };
  };

  // floors top-first so upper storeys sit at the top of the tower
  const floors = childrenOf(building.id, "floor")
    .map((z, i) => ({ z, e: floorElevation(z.name, i) }))
    .sort((a, b) => b.e - a.e)
    .map((x) => x.z);
  const directAreas = childrenOf(building.id, "area");
  const rowsSrc: { label?: string; slabs: Slab[] }[] = [];

  for (const floor of floors) {
    const areas = childrenOf(floor.id, "area");
    rowsSrc.push({
      label: floor.name,
      slabs: (areas.length ? areas : [floor]).map(makeSlab),
    });
  }
  if (directAreas.length) rowsSrc.push({ slabs: directAreas.map(makeSlab) });
  if (!rowsSrc.length) rowsSrc.push({ slabs: [makeSlab(building)] });

  // vertical layout
  let y = PAD_TOP;
  const rows: FloorRow[] = rowsSrc.map((r) => {
    y += FLOOR_GAP;
    const labelY = y - 12;
    const slabs = r.slabs.map((slab) => {
      const cy = y + SLAB_HH;
      y += ROW_STEP;
      return { slab, cy };
    });
    return { label: r.label, labelY, slabs };
  });

  const occ = occById.get(building.id);
  const leaves = rows.flatMap((r) => r.slabs.map((s) => s.slab));
  return {
    zone: building,
    total: occ?.count ?? leaves.reduce((s, x) => s + x.count, 0),
    congested: leaves.some((s) => s.congested),
    rows,
    height: y + PAD_BOTTOM,
  };
}

// --- building tower --------------------------------------------------------
function BuildingTower({
  vm,
  reduceMotion,
  onHover,
  onLeave,
}: {
  vm: BuildingVM;
  reduceMotion: boolean;
  onHover: (info: Omit<HoverInfo, "x" | "y">, e: React.MouseEvent) => void;
  onLeave: () => void;
}) {
  const { t } = useBranding();
  // Building plinth — a wider isometric base the floor slabs stack on top of.
  const lastCy = Math.max(...vm.rows.flatMap((r) => r.slabs.map((s) => s.cy)));
  const py = lastCy + 22;
  const HWp = SLAB_HW * 1.06;
  const HHp = SLAB_HH * 1.02;
  const Tp = SLAB_T * 1.6;

  return (
    <div className="card flex flex-col p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate font-display font-semibold text-text">{vm.zone.name}</h3>
        </div>
        <span className="tnum shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
          {vm.total}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${SVG_W} ${vm.height}`}
        width={SVG_W}
        className="mx-auto h-auto w-full"
        style={{ maxWidth: SVG_W, overflow: "visible" }}
        role="img"
        aria-label={`${vm.zone.name} — ${vm.total}`}
      >
        {/* plinth (drawn first so floor slabs paint on top of it) */}
        <path
          d={`M${CX - HWp},${py} L${CX},${py + HHp} L${CX},${py + HHp + Tp} L${CX - HWp},${py + Tp} Z`}
          fill="rgb(var(--surface) / 0.95)"
        />
        <path
          d={`M${CX + HWp},${py} L${CX},${py + HHp} L${CX},${py + HHp + Tp} L${CX + HWp},${py + Tp} Z`}
          fill="rgb(var(--surface-2) / 0.6)"
        />
        <path
          d={`M${CX},${py - HHp} L${CX + HWp},${py} L${CX},${py + HHp} L${CX - HWp},${py} Z`}
          fill="rgb(var(--surface-2) / 0.85)"
          stroke="rgb(var(--border))"
          strokeWidth={1}
        />

        {vm.rows.map((row, ri) => (
          <g key={ri}>
            {row.label && (
              <text
                x={PAD_X}
                y={row.labelY}
                className="fill-text-muted"
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}
              >
                {shortName(row.label, 30)}
              </text>
            )}
            {row.slabs.map(({ slab, cy }) => {
              const tone = occTone(slab.count, slab.capacity);
              const c = toneVars(tone);
              const names = slab.people.map((p) => p.member_name);
              const hover = (e: React.MouseEvent) =>
                onHover(
                  { name: slab.zone.name, count: slab.count, capacity: slab.capacity, names },
                  e,
                );
              return (
                <g key={slab.zone.id}>
                  {/* faces */}
                  <path d={leftPath(CX, cy)} fill={c.left} />
                  <path d={rightPath(CX, cy)} fill={c.right} />
                  <path d={topPath(CX, cy)} fill={c.top} stroke={c.stroke} strokeWidth={1.2} />

                  {/* people dots */}
                  {slab.people.map((p) => {
                    const seed = hashString(p.member_id + slab.zone.id);
                    const { x, y } = dotAt(seed, CX, cy);
                    const style = reduceMotion
                      ? undefined
                      : ({
                          "--dx": `${(frac(seed * 9.39) * 2 - 1) * 5}px`,
                          "--dy": `${(frac(seed * 3.71) * 2 - 1) * 4}px`,
                          "--drift-dur": `${5 + frac(seed * 7.19) * 4}s`,
                          "--drift-delay": `${frac(seed * 5.17) * 3}s`,
                        } as React.CSSProperties);
                    return (
                      <circle
                        key={p.member_id}
                        cx={x}
                        cy={y}
                        r={3.5}
                        className={reduceMotion ? "map-dot" : "map-dot--drift"}
                        style={style}
                        fill="rgb(var(--primary))"
                        stroke="rgb(var(--bg))"
                        strokeWidth={1}
                      />
                    );
                  })}

                  {/* zone name along the front edge */}
                  <text
                    x={CX}
                    y={cy + SLAB_HH - 6}
                    textAnchor="middle"
                    className="fill-text-muted"
                    style={{ fontSize: 10 }}
                  >
                    {shortName(slab.zone.name, 26)}
                  </text>

                  {/* count chip (top-right) — always visible for colourblind safety */}
                  <g transform={`translate(${CX + SLAB_HW * 0.4}, ${cy - SLAB_HH * 0.34})`}>
                    <rect
                      x={-15}
                      y={-11}
                      width={slab.capacity ? 40 : 24}
                      height={20}
                      rx={7}
                      fill="rgb(var(--surface) / 0.92)"
                      stroke={c.stroke}
                      strokeWidth={1}
                    />
                    <text
                      x={slab.capacity ? 5 : 0}
                      y={4}
                      textAnchor="middle"
                      className="tnum"
                      style={{ fontSize: 12, fontWeight: 700, fill: c.solid }}
                    >
                      {slab.capacity ? `${slab.count}/${slab.capacity}` : slab.count}
                    </text>
                  </g>

                  {/* congestion badge (top-left) */}
                  {slab.congested && (
                    <g transform={`translate(${CX - SLAB_HW * 0.42}, ${cy - SLAB_HH * 0.34})`}>
                      <circle r={9} fill="rgb(var(--accent) / 0.18)" stroke="rgb(var(--accent))" strokeWidth={1} />
                      <text
                        x={0}
                        y={3.5}
                        textAnchor="middle"
                        style={{ fontSize: 11, fontWeight: 700, fill: "rgb(var(--accent))" }}
                      >
                        !
                      </text>
                    </g>
                  )}

                  {/* invisible hit area covering the whole slab silhouette */}
                  <polygon
                    points={silhouette(CX, cy)}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={hover}
                    onMouseMove={hover}
                    onMouseLeave={onLeave}
                  />
                </g>
              );
            })}
          </g>
        ))}
      </svg>

      {vm.congested && (
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-accent">
          <AlertTriangle className="h-3 w-3" />
          {t("map.congestion")}
        </p>
      )}
    </div>
  );
}

// --- page ------------------------------------------------------------------
export default function MapPage() {
  const { t, term } = useBranding();
  const [zones, setZones] = useState<Zone[]>([]);
  const [occupancy, setOccupancy] = useState<ZoneOccupancy[]>([]);
  const [people, setPeople] = useState<PresencePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [emergency, setEmergency] = useState(false);
  const [live, setLive] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const refreshLive = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [occ, pres] = await Promise.all([getZoneOccupancy(), getPresenceNow()]);
      setOccupancy(occ);
      setPeople(pres.people);
    } catch {
      /* keep the last good frame — the map must degrade gracefully */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getZones(), getZoneOccupancy(), getPresenceNow()])
      .then(([z, occ, pres]) => {
        if (!active) return;
        setZones(z);
        setOccupancy(occ);
        setPeople(pres.people);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));

    // Each granted access can move a dot — refetch occupancy + presence, debounced.
    const unsub = streamEvents(
      (ev: AccessEvent) => {
        if (ev.decision !== "granted") return;
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(refreshLive, 700);
      },
      { onStatus: setLive },
    );
    return () => {
      active = false;
      if (debounce.current) clearTimeout(debounce.current);
      unsub();
    };
  }, [refreshLive]);

  const occById = useMemo(() => new Map(occupancy.map((o) => [o.zone_id, o])), [occupancy]);
  const peopleByZone = useMemo(() => {
    const m = new Map<string, PresencePerson[]>();
    for (const p of people) {
      if (!p.zone_id) continue;
      m.set(p.zone_id, [...(m.get(p.zone_id) ?? []), p]);
    }
    return m;
  }, [people]);

  const buildings = useMemo(() => {
    const roots = zones.filter((z) => z.kind === "building" || !z.parent_id);
    // de-dupe (a building has no parent, but guard against a root area/floor too)
    const seen = new Set<string>();
    return roots
      .filter((z) => (seen.has(z.id) ? false : (seen.add(z.id), true)))
      .map((b) => buildBuilding(b, zones, occById, peopleByZone));
  }, [zones, occById, peopleByZone]);

  const totalOnSite = people.length;

  const onHover = useCallback((info: Omit<HoverInfo, "x" | "y">, e: React.MouseEvent) => {
    setHover({ ...info, x: e.clientX, y: e.clientY });
  }, []);
  const onLeave = useCallback(() => setHover(null), []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl ring-1",
              emergency ? "bg-danger/10 text-danger ring-danger/20" : "bg-primary/10 text-primary ring-primary/20",
            )}
          >
            {emergency ? <AlertTriangle className="h-5 w-5" /> : <MapIcon className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-text">{t("map.title")}</h2>
            <p className="flex items-center gap-1.5 text-sm text-text-muted">
              <Radio className={cn("h-3.5 w-3.5", live ? "animate-pulse text-primary" : "text-text-muted")} />
              {t("map.subtitle")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setEmergency((v) => !v)}
          aria-pressed={emergency}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            emergency
              ? "bg-danger text-white shadow-[0_8px_24px_-10px_rgb(var(--danger)/0.7)] hover:brightness-105"
              : "border border-danger/40 text-danger hover:bg-danger/10",
          )}
        >
          <AlertTriangle className="h-4 w-4" />
          {emergency ? t("map.emergency.exit") : t("map.emergency")}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-[420px] w-full rounded-2xl" />
          ))}
        </div>
      ) : buildings.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title={t("map.empty.title")}
          description={t("map.empty.desc")}
          action={
            <Link href="/zones" className="btn-primary inline-flex px-4 py-2 text-sm">
              {t("zones.add")}
            </Link>
          }
        />
      ) : emergency ? (
        <EvacuationView buildings={buildings} total={totalOnSite} />
      ) : (
        <>
          <Legend />
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {buildings.map((vm) => (
              <BuildingTower
                key={vm.zone.id}
                vm={vm}
                reduceMotion={reduceMotion}
                onHover={onHover}
                onLeave={onLeave}
              />
            ))}
          </div>
        </>
      )}

      {/* Hover tooltip (fixed to the cursor so SVG scaling never mis-places it) */}
      {hover && !emergency && (
        <div
          className="pointer-events-none fixed z-50 w-56 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-surface/95 p-3 shadow-pop backdrop-blur-sm"
          style={{ left: hover.x, top: hover.y - 12 }}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="truncate font-medium text-text">{hover.name}</p>
            <span className="tnum shrink-0 text-sm font-semibold text-primary">
              {hover.capacity ? `${hover.count}/${hover.capacity}` : hover.count}
            </span>
          </div>
          {hover.names.length > 0 ? (
            <p className="text-xs leading-relaxed text-text-muted">
              {hover.names.slice(0, MAX_TOOLTIP_NAMES).join(", ")}
              {hover.names.length > MAX_TOOLTIP_NAMES ? ` +${hover.names.length - MAX_TOOLTIP_NAMES}` : ""}
            </p>
          ) : (
            <p className="text-xs text-text-muted">{term.personPlural}: 0</p>
          )}
        </div>
      )}
    </div>
  );
}

function Legend() {
  const { t, term } = useBranding();
  const swatch = (cls: string) => (
    <span className={cn("inline-block h-3 w-4 rounded-sm ring-1", cls)} aria-hidden />
  );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-muted">
      <span className="font-medium text-text">{t("map.occupancy")}</span>
      <span className="flex items-center gap-1.5">
        {swatch("bg-primary/25 ring-primary/50")}
        {swatch("bg-accent/25 ring-accent/50")}
        {swatch("bg-danger/25 ring-danger/50")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
        {term.personSingular}
      </span>
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-accent" />
        {t("map.congestion")}
      </span>
    </div>
  );
}

/** Emergency mode — a stark evacuation view: big total, per-zone counts, muster link. */
function EvacuationView({ buildings, total }: { buildings: BuildingVM[]; total: number }) {
  const { t } = useBranding();
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="card flex flex-col items-center gap-2 border-danger/30 bg-danger/[0.04] p-8 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-danger">{t("map.onSiteTotal")}</p>
        <p className="tnum font-display text-6xl font-semibold leading-none text-text">{total}</p>
        <Link
          href="/presence"
          className="btn-primary mt-3 inline-flex items-center gap-2 px-5 py-2.5 text-sm"
        >
          <Users className="h-4 w-4" />
          {t("presence.muster")}
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {buildings.map((b) => {
          const leaves = b.rows.flatMap((r) => r.slabs.map((s) => s.slab));
          return (
            <div key={b.zone.id} className="card p-4">
              <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
                <span className="flex items-center gap-2 font-display font-semibold text-text">
                  <Building2 className="h-4 w-4 text-danger" />
                  {b.zone.name}
                </span>
                <span className="tnum text-lg font-semibold text-danger">{b.total}</span>
              </div>
              <ul className="space-y-1.5">
                {leaves.map((s) => (
                  <li key={s.zone.id} className="flex items-center justify-between text-sm">
                    <span className={cn("truncate", s.count > 0 ? "text-text" : "text-text-muted")}>
                      {s.zone.name}
                    </span>
                    <span
                      className={cn(
                        "tnum shrink-0 font-semibold",
                        s.count > 0 ? "text-danger" : "text-text-muted",
                      )}
                    >
                      {s.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
