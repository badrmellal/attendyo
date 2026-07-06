"use client";

/**
 * BrandLogo — the Check Gate mark + wordmark.
 *
 * The glyph is inline SVG so it recolors from the live `--primary` token (set by
 * BrandingProvider). The wordmark text is the branding `product_name`, never a
 * hard-coded "Attendyo". If the operator configures a `logo_url`, we show that
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
  // The Check Gate — a soft rounded doorway with a checkmark resolving at its
  // heart. Inline SVG so it recolors from the live --primary / --accent tokens
  // (set by BrandingProvider). This exact path is shared verbatim with the
  // Gate app's favicon so the mark is pixel-identical everywhere.
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
        stroke="rgb(var(--accent))"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
