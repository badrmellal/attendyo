"use client";

import { useId } from "react";
import Image from "next/image";
import type { Branding } from "@/lib/types";
import { cn } from "@/lib/cn";

interface BrandLogoProps {
  branding: Branding;
  className?: string;
  /** Mark size in px (the tile is square). */
  size?: number;
}

/**
 * The Aperture Tile mark, used on the kiosk.
 *
 * An app-icon-grade rounded tile: an ultramarine→violet gradient (from the live
 * `--primary` / `--primary-2` tokens), a portal opening reversed out in white,
 * and a gold "recognised" spark (`--accent`) — so it recolors for white-label
 * customers. Pixel-identical to the Console mark and both favicons. If
 * branding.logo_url is set we render that instead (white-label escape hatch).
 */
export function ApertureMark({ size = 30, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gid = `am-${uid}`;
  const hid = `amh-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
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
      <rect width="52" height="52" rx="14" fill={`url(#${gid})`} />
      <rect width="52" height="52" rx="14" fill={`url(#${hid})`} />
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
      <circle cx="26" cy="22.5" r="2.7" fill="rgb(var(--accent))" />
    </svg>
  );
}

export function BrandLogo({ branding, className, size = 30 }: BrandLogoProps) {
  if (branding.logo_url) {
    return (
      <Image
        src={branding.logo_url}
        alt={branding.product_name}
        height={size}
        width={size * 5}
        unoptimized
        className={cn("h-auto w-auto object-contain", className)}
        style={{ maxHeight: size }}
        priority
      />
    );
  }

  return (
    <div className={cn("flex items-center gap-3", className)} aria-label={branding.product_name}>
      <ApertureMark size={size} />
      <span
        className="font-display text-text"
        style={{ fontSize: size * 0.74, fontWeight: 600, letterSpacing: "-0.01em" }}
      >
        {branding.product_name}
      </span>
    </div>
  );
}
