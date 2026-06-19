"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/types";
import { localeTag } from "@/lib/branding";
import { cn } from "@/lib/cn";

interface ClockProps {
  locale: Locale;
  className?: string;
}

/**
 * Live wall clock + date for the idle screen. Updates every second, formatted
 * for the active locale (fr-MA / en-GB / ar-MA). Hydration-safe: renders nothing
 * until mounted so the server/client first paint never mismatch on time.
 */
export function Clock({ locale, className }: ClockProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const tag = localeTag(locale);
  const time = now
    ? new Intl.DateTimeFormat(tag, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now)
    : "––:––";
  const date = now
    ? new Intl.DateTimeFormat(tag, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(now)
    : "";

  return (
    <div className={cn("text-center", className)}>
      <div className="tabular font-display text-[clamp(3.5rem,9vw,6.5rem)] font-semibold leading-none text-text">
        {time}
      </div>
      <div className="mt-2 text-[clamp(0.95rem,2.2vw,1.4rem)] font-medium capitalize text-text-muted">
        {date}
      </div>
    </div>
  );
}
