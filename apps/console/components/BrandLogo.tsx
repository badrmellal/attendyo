"use client";

/**
 * BrandLogo — the watchful-gate aperture mark + wordmark.
 *
 * The glyph is inline SVG so it recolors from the live `--primary` token (set by
 * BrandingProvider). The wordmark text is the branding `product_name`, never a
 * hard-coded "Liwan". If the operator configures a `logo_url`, we show that
 * image instead — this is the white-label escape hatch.
 */

import { useBranding } from "./BrandingProvider";
import { cn } from "@/lib/utils";

type Props = {
  /** Show the wordmark beside the glyph. */
  withWordmark?: boolean;
  size?: number;
  className?: string;
};

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  // The iwan — a horseshoe Moroccan arch with a recognised "face" dot at its
  // heart. Inline SVG so it recolors from the live --primary / --primary-2
  // tokens (set by BrandingProvider). The arch motif is the brand's through-line.
  const height = Math.round((size * 28) / 24);
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 24 28"
      fill="none"
      role="img"
      aria-hidden="true"
      className={cn("text-primary", className)}
    >
      <defs>
        <linearGradient id="liwan-arch" x1="4" y1="3" x2="20" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgb(var(--primary))" />
          <stop offset="1" stopColor="rgb(var(--primary-2))" />
        </linearGradient>
      </defs>
      {/* Outer horseshoe arch */}
      <path
        d="M4 27 V12.5 C4 6.7 7.6 3 12 3 C16.4 3 20 6.7 20 12.5 V27"
        stroke="url(#liwan-arch)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Inner arch — the recessed threshold */}
      <path
        d="M8 27 V13 C8 9.5 9.8 7.4 12 7.4 C14.2 7.4 16 9.5 16 13 V27"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.45"
      />
      {/* The recognised face at the centre */}
      <circle cx="12" cy="12.2" r="2.1" fill="currentColor" />
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
          style={{ fontSize: size * 0.62 }}
        >
          {branding.product_name}
        </span>
      )}
    </div>
  );
}
