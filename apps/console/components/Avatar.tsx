"use client";

/**
 * Avatar — photo when available, otherwise initials on a deterministic tint.
 * Falls back to initials if the photo fails to load (404 / 401 / broken), so a
 * missing image never shows a broken-image glyph.
 */

import { useState } from "react";
import { cn, initials, hueFromString } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = 36,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hue = hueFromString(name);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        className={cn("rounded-full object-cover ring-1 ring-border", className)}
      />
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 45% 24%), hsl(${hue} 50% 16%))`,
        color: `hsl(${hue} 70% 78%)`,
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-border select-none",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
