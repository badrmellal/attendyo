"use client";

import Image from "next/image";
import type { Branding } from "@/lib/types";
import { cn } from "@/lib/cn";

interface BrandLogoProps {
  branding: Branding;
  className?: string;
  /** Wordmark glyph height in px. */
  size?: number;
}

/**
 * Brand wordmark for the kiosk.
 *
 * If branding.logo_url is set we render that (white-label customer logo).
 * Otherwise we draw the Liwan arch glyph — the horseshoe *iwan* with a
 * recognised "face" dot inside — recoloured from the ultramarine `--primary`
 * token, plus the product_name wordmark set in the Fraunces display serif.
 * Never hard-codes "Liwan": the text comes from branding.product_name.
 */
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
    <div
      className={cn("flex items-center gap-3", className)}
      aria-label={branding.product_name}
    >
      {/* The Liwan arch (iwan) with a recognised face dot. Strokes use --primary. */}
      <svg
        width={(size * 24) / 28}
        height={size}
        viewBox="0 0 24 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-primary"
        aria-hidden="true"
      >
        <path
          d="M4 27 V12.5 C4 6.7 7.6 3 12 3 C16.4 3 20 6.7 20 12.5 V27"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M8 27 V13 C8 9.5 9.8 7.4 12 7.4 C14.2 7.4 16 9.5 16 13 V27"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.45"
        />
        <circle cx="12" cy="12.2" r="2.1" fill="currentColor" />
      </svg>
      <span
        className="font-display text-text"
        style={{
          fontSize: size * 0.74,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        {branding.product_name}
      </span>
    </div>
  );
}
