"use client";

/**
 * Monitor — a full-bleed live access wall. Subscribes to the SSE stream and
 * shows decisions as they happen (granted ultramarine, denied red, gated gold),
 * plus a rolling count strip. Built to be left open on a wall display.
 */

import { useEffect, useRef, useState } from "react";
import { Radio, ShieldCheck, ShieldX, ListFilter } from "lucide-react";
import { LiveFeed } from "@/components/LiveFeed";
import { useBranding } from "@/components/BrandingProvider";
import { listDoors, streamEvents } from "@/lib/api";
import type { AccessEvent, Door } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function MonitorPage() {
  const { decisionLabel } = useBranding();
  const [live, setLive] = useState(false);
  const [doors, setDoors] = useState<Door[]>([]);
  const [counts, setCounts] = useState({ granted: 0, denied: 0, total: 0 });
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    listDoors().then(setDoors).catch(() => {});
  }, []);

  // A second, lightweight subscription purely to keep the running counters.
  // (LiveFeed maintains its own list; counters here stay in sync via the same
  // stream without coupling the two components.)
  useEffect(() => {
    const unsub = streamEvents(
      (ev: AccessEvent) => {
        if (seen.current.has(ev.id)) return;
        seen.current.add(ev.id);
        setCounts((c) => ({
          granted: c.granted + (ev.decision === "granted" ? 1 : 0),
          denied: c.denied + (ev.decision !== "granted" ? 1 : 0),
          total: c.total + 1,
        }));
      },
      { onStatus: setLive },
    );
    return unsub;
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl ring-1",
              live
                ? "bg-primary/10 text-primary ring-primary/20"
                : "bg-accent/10 text-accent ring-accent/20",
            )}
          >
            <Radio className={cn("h-5 w-5", live && "animate-pulse")} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-text">
              Surveillance en direct
            </h2>
            <p className="text-sm text-text-muted">
              {live ? "Connecté au flux d'accès" : "Flux simulé (démo)"}
            </p>
          </div>
        </div>

        {/* Counters */}
        <div className="flex items-center gap-3">
          <Counter icon={ShieldCheck} label={decisionLabel("granted")} value={counts.granted} tone="ok" />
          <Counter icon={ShieldX} label="Refusés" value={counts.denied} tone="danger" />
          <Counter icon={ListFilter} label="Total" value={counts.total} tone="muted" />
        </div>
      </div>

      {/* Full-bleed feed */}
      <div className="card relative overflow-hidden p-5">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/[0.04] to-transparent"
          aria-hidden
        />
        <div className="relative max-h-[calc(100vh-260px)] min-h-[420px] overflow-y-auto pr-1">
          <LiveFeed max={40} variant="bleed" onLive={setLive} />
        </div>
      </div>

      {doors.length > 0 && (
        <p className="text-center text-xs text-text-muted">
          Surveillance de{" "}
          <span className="font-medium text-text">{doors.filter((d) => d.enabled).length}</span>{" "}
          porte(s) active(s)
        </p>
      )}
    </div>
  );
}

function Counter({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: number;
  tone: "ok" | "danger" | "muted";
}) {
  const cls = {
    ok: "text-primary",
    danger: "text-danger",
    muted: "text-text-muted",
  }[tone];
  return (
    <div className="card-quiet flex items-center gap-2.5 px-3.5 py-2">
      <Icon className={cn("h-4 w-4", cls)} />
      <div className="leading-tight">
        <p className={cn("tnum font-display text-lg font-semibold", cls)}>{value}</p>
        <p className="text-[11px] text-text-muted">{label}</p>
      </div>
    </div>
  );
}
