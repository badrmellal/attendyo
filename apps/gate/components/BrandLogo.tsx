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
 * Otherwise we draw the Check Gate glyph — a minimal rounded doorway with a
 * checkmark resolving at its centre — recoloured from the ultramarine
 * `--primary` token, plus the product_name wordmark set in the Fraunces
 * display serif. Never hard-codes "Attendyo": the text comes from
 * branding.product_name. Path is verbatim from brand/BRAND.md so the mark is
 * pixel-identical to the Console and the favicon.
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
      {/* The Check Gate: a soft rounded doorway with a checkmark resolving inside
          it. Strokes use --primary; verbatim path from brand/BRAND.md. */}
      <svg
        width={(size * 24) / 28}
        height={size}
        viewBox="0 0 24 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-primary"
        aria-hidden="true"
      >
        {/* The gate: a soft rounded doorway, not a horseshoe arch */}
        <path
          d="M4 26 V11 C4 6.6 7.6 3 12 3 C16.4 3 20 6.6 20 11 V26"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* The check: resolving inside it */}
        <path
          d="M8.3 15.6 L11 18.4 L16.2 12.4"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
