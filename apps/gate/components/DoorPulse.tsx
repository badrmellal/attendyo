"use client";

import { cn } from "@/lib/cn";

interface DoorPulseProps {
  /** Mount only while active so the animation replays each grant. */
  active: boolean;
  className?: string;
}

/**
 * The signature door-open moment: two ultramarine rings expand outward from the
 * keystone — the top centre of the doorway frame where the face appears —
 * with a soft radial glow. Mounted only on GRANTED, unmounted on idle so the
 * keyframes restart cleanly every time. Purely decorative (aria-hidden).
 *
 * Color comes from the `--primary` / `--primary-glow` tokens, so it follows the
 * white-label brand ultramarine.
 */
export function DoorPulse({ active, className }: DoorPulseProps) {
  if (!active) return null;

  return (
    <div
      className={cn(
        // Origin at the keystone: top-centre of the canvas, where the gate's
        // crown and the recognised face sit.
        "pointer-events-none absolute inset-0 z-0 flex justify-center",
        className,
      )}
      style={{ alignItems: "flex-start", paddingTop: "18vh" }}
      aria-hidden="true"
    >
      {/* Soft expanding glow behind everything, blooming from the keystone. */}
      <div
        className="absolute h-[70vmin] w-[70vmin] animate-glow-pulse rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)",
        }}
      />
      {/* Two expanding rings, slightly staggered. */}
      <div
        className="absolute h-[56vmin] w-[56vmin] animate-door-ring rounded-full"
        style={{ boxShadow: "0 0 0 2px rgb(var(--primary))" }}
      />
      <div
        className="absolute h-[56vmin] w-[56vmin] animate-door-ring-delayed rounded-full"
        style={{ boxShadow: "0 0 0 2px rgb(var(--primary))" }}
      />
    </div>
  );
}
