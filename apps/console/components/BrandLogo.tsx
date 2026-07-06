"use client";

/**
 * BrandLogo — the Aperture Tile mark + wordmark.
 *
 * The mark is an app-icon-grade rounded tile: an ultramarine→violet gradient
 * (from the live `--primary` / `--primary-2` tokens), a portal opening reversed
 * out in white, and a gold "recognised" spark (`--accent`). Because it reads
 * those CSS tokens it recolors for white-label customers. The wordmark is the
 * branding `product_name`, never a hard-coded "Attendyo". If the operator
 * configures a `logo_url`, we show that image instead — the white-label escape
 * hatch. This path is shared verbatim with the Gate app + both favicons so the
 * mark is pixel-identical everywhere.
 */

import { useId } from "react";
import { useBranding } from "./BrandingProvider";
import { cn } from "@/lib/utils";

type Props = {
  /** Show the wordmark beside the mark. */
  withWordmark?: boolean;
  size?: number;
  className?: string;
};

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  // Unique gradient ids per instance so multiple marks on one page never clash.
  const uid = useId().replace(/:/g, "");
  const gid = `am-${uid}`;
  const hid = `amh-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      role="img"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgb(var(--primary))" />
          <stop offset="1" stopColor="rgb(var(--primary-2))" />
        </linearGradient>
        <linearGradient id={hid} x1="26" y1="0" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Gradient tile + a soft top highlight for depth. */}
      <rect width="52" height="52" rx="14" fill={`url(#${gid})`} />
      <rect width="52" height="52" rx="14" fill={`url(#${hid})`} />
      {/* The portal opening, reversed out in white. */}
      <path
        d="M16 40 V24 C16 16.8 20.5 12 26 12 C31.5 12 36 16.8 36 24 V40"
        stroke="#fff"
        strokeWidth="3.1"
        strokeLinecap="round"
        opacity="0.96"
      />
      <path
        d="M22 40 V26 C22 22 23.8 20 26 20 C28.2 20 30 22 30 26 V40"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* The gold "recognised" spark. */}
      <circle cx="26" cy="22.5" r="2.7" fill="rgb(var(--accent))" />
    </svg>
  );
}

export function BrandLogo({ withWordmark = true, size = 28, className }: Props) {
  const { branding } = useBranding();

  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      {branding.logo_url ? (
        // White-label custom logo.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logo_url}
          alt={branding.product_name}
          height={size}
          style={{ height: size, width: "auto" }}
          className="object-contain"
        />
      ) : (
        <BrandMark size={size} />
      )}
      {withWordmark && !branding.logo_url && (
        <span
          className="font-display font-semibold tracking-tight text-text"
          style={{ fontSize: size * 0.68 }}
        >
          {branding.product_name}
        </span>
      )}
    </div>
  );
}
