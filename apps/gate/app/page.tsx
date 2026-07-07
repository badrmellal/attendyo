"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraView, type CameraHandle, type CameraStatus } from "@/components/CameraView";
import { RecognitionOverlay } from "@/components/RecognitionOverlay";
import { DoorPulse } from "@/components/DoorPulse";
import { Clock } from "@/components/Clock";
import { BrandLogo } from "@/components/BrandLogo";
import {
  accessEventToKioskResult,
  ApiError,
  fetchBranding,
  isAccessEvent,
  recognizeFrame,
  resolveConfig,
  subscribeAccessStream,
  toKioskResult,
  type KioskConfig,
} from "@/lib/api";
import { mockRecognize } from "@/lib/mock";
import { DEFAULT_BRANDING, getStrings, isRTL } from "@/lib/branding";
import type { Branding, KioskResult } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Cadence: how often to attempt a capture while idle (~1.5s per the spec). */
const CAPTURE_INTERVAL_MS = 1500;
/** How long a result stays on screen before returning to idle. */
const GRANTED_HOLD_MS = 3500;
const DENIED_HOLD_MS = 2600;
/** Abort a recognize call that hangs longer than this. */
const RECOGNIZE_TIMEOUT_MS = 8000;
/** Re-pull branding occasionally so a settings change reaches the kiosk. */
const BRANDING_REFRESH_MS = 60_000;

type Phase = "idle" | "showing";

export default function GatePage() {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [config, setConfig] = useState<KioskConfig>({ mock: false });
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<KioskResult | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  // Set when the API rejects this terminal's device key (401/403): an
  // install-time misconfiguration. Surfaced quietly so setup can't fail silent.
  const [configError, setConfigError] = useState(false);

  const cameraRef = useRef<CameraHandle>(null);
  // `phase` read inside the interval without re-subscribing it each render.
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  // Guards overlapping recognize calls (one in flight at a time).
  const busyRef = useRef(false);

  // --- one-time config + branding bootstrap -------------------------------
  useEffect(() => {
    const search =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : undefined;
    setConfig(resolveConfig(search));

    const controller = new AbortController();
    void fetchBranding(controller.signal).then(setBranding);
    const id = window.setInterval(() => {
      void fetchBranding().then(setBranding);
    }, BRANDING_REFRESH_MS);

    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  // --- apply brand colors to the CSS token layer (white-label) ------------
  useEffect(() => {
    const root = document.documentElement;
    // Tokens are consumed as `rgb(var(--primary) / <alpha>)`, so they must be
    // "R G B" triplets — NOT hex. Convert here; keep the globals.css default if
    // a brand color is malformed.
    const pri = hexToTriplet(branding.primary_color);
    if (pri) root.style.setProperty("--primary", pri);
    const acc = hexToTriplet(branding.accent_color);
    if (acc) root.style.setProperty("--accent", acc);
    // Derive the glow from the primary color at ~20% alpha (full rgba string,
    // consumed directly as `var(--primary-glow)`).
    root.style.setProperty(
      "--primary-glow",
      hexWithAlpha(branding.primary_color, 0.2),
    );
    root.lang = branding.locale;
    root.dir = isRTL(branding.locale) ? "rtl" : "ltr";
  }, [branding]);

  const strings = useMemo(() => getStrings(branding.locale), [branding.locale]);

  // --- present a result, then schedule the return to idle -----------------
  const present = useCallback((r: KioskResult) => {
    setResult(r);
    setPhase("showing");
  }, []);

  useEffect(() => {
    if (phase !== "showing" || !result) return;
    const hold = result.decision === "granted" ? GRANTED_HOLD_MS : DENIED_HOLD_MS;
    const id = window.setTimeout(() => {
      setPhase("idle");
      setResult(null);
    }, hold);
    return () => window.clearTimeout(id);
  }, [phase, result]);

  // --- capture loop -------------------------------------------------------
  const runCapture = useCallback(async () => {
    // Throttle: skip while showing a result or while a call is in flight.
    if (phaseRef.current !== "idle" || busyRef.current) return;

    if (config.mock) {
      busyRef.current = true;
      try {
        present(toKioskResult(mockRecognize()));
      } finally {
        busyRef.current = false;
      }
      return;
    }

    const cam = cameraRef.current;
    if (!cam || !cam.isReady()) return;

    busyRef.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      RECOGNIZE_TIMEOUT_MS,
    );
    try {
      const frame = await cam.capture();
      if (!frame) return;
      const raw = await recognizeFrame(frame, config, controller.signal);
      // The API "denied" path uses door_opened=false; only `granted` opens.
      setConfigError(false);
      present(toKioskResult(raw));
    } catch (err) {
      // A 401/403 means the terminal itself is rejected (bad/missing device
      // key) — a persistent install problem worth surfacing. Anything else
      // (network blip / abort / API booting) stays silent: the kiosk must never
      // show an error wall to a person at a door.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setConfigError(true);
      }
    } finally {
      window.clearTimeout(timeout);
      busyRef.current = false;
    }
  }, [config, present]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void runCapture();
    }, CAPTURE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [runCapture]);

  // --- live SSE feed: react to events for THIS door (Bridge / RTSP cams) ---
  // Keep latest config/present in refs so the EventSource is opened once.
  const presentRef = useRef(present);
  presentRef.current = present;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    // In mock mode there is no API to stream from.
    if (config.mock) return;
    const unsubscribe = subscribeAccessStream((data) => {
      // Don't interrupt a result already on screen.
      if (phaseRef.current !== "idle") return;
      if (!isAccessEvent(data)) return;
      // Only react to events for the door this terminal is mounted on.
      const doorId = configRef.current.doorId;
      if (doorId && data.door_id && data.door_id !== doorId) return;
      // The kiosk's own recognize calls already cover its webcam; only surface
      // granted events here to avoid double-showing denials from other sources.
      if (data.decision !== "granted") return;
      presentRef.current(accessEventToKioskResult(data));
    });
    return unsubscribe;
    // Re-subscribe only when mock toggles (config identity is otherwise stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.mock]);

  const granted = phase === "showing" && result?.decision === "granted";
  const tone: "idle" | "granted" | "denied" = granted
    ? "granted"
    : phase === "showing"
      ? "denied"
      : "idle";

  return (
    <main className="vignette relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-bg">
      {/* Door-open signature pulse, behind content, only while granted. */}
      <DoorPulse active={granted} />

      {/* Top bar: wordmark + live clock when idle. */}
      <header className="relative z-10 flex items-center justify-between px-8 pt-7 sm:px-12">
        <BrandLogo branding={branding} size={28} />
        {phase === "idle" && (
          <div className="hidden sm:block">
            <Clock
              locale={branding.locale}
              className="text-right [&>div:first-child]:text-2xl [&>div:last-child]:text-sm"
            />
          </div>
        )}
      </header>

      {/* Center stage. */}
      <section className="relative z-10 flex flex-1 items-center justify-center px-6 sm:px-10">
        {phase === "showing" && result ? (
          <RecognitionOverlay result={result} locale={branding.locale} />
        ) : (
          <div className="flex w-full max-w-md flex-col items-center">
            <CameraView
              ref={cameraRef}
              mock={config.mock}
              tone={tone}
              onStatusChange={setCameraStatus}
              className="w-full max-w-[min(78vw,420px)]"
            />

            {/* Idle clock for small screens that hid the header clock. */}
            <div className="mt-8 sm:hidden">
              <Clock locale={branding.locale} />
            </div>

            {(() => {
              const blocked = cameraStatus === "blocked" && !config.mock;
              const misconfigured = configError && !config.mock && !blocked;
              const title = blocked
                ? strings.cameraBlocked
                : misconfigured
                  ? strings.notConfigured
                  : strings.lookHint;
              const hint = blocked
                ? strings.cameraBlockedHint
                : misconfigured
                  ? strings.notConfiguredHint
                  : null;
              return (
                <>
                  <p
                    className={cn(
                      "mt-8 text-center text-[clamp(1.05rem,3vw,1.6rem)] font-medium",
                      misconfigured ? "text-accent" : "text-text",
                    )}
                  >
                    {title}
                  </p>
                  {hint && (
                    <p className="mt-2 text-center text-sm text-text-muted">{hint}</p>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </section>

      {/* Footer: tagline wordmark + a quiet on-prem privacy line while idle. */}
      <footer className="relative z-10 flex flex-col items-center justify-center gap-1.5 pb-7 sm:pb-9">
        {branding.tagline && (
          <p className="text-center text-xs font-medium uppercase tracking-[0.22em] text-text-muted/70">
            {branding.tagline}
          </p>
        )}
        {phase === "idle" && (
          <p className="text-center text-[0.7rem] font-medium text-text-muted/50">
            {strings.privacyLine}
          </p>
        )}
      </footer>
    </main>
  );
}

/**
 * Convert a #RRGGBB (or #RGB) hex to an rgba() string with the given alpha.
 * Falls back to the input when parsing fails, so a malformed brand color can
 * never throw on the kiosk.
 */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  let h = m[1]!;
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Convert a #RRGGBB (or #RGB) hex to an "R G B" triplet, for tokens consumed as
 * `rgb(var(--token) / <alpha>)`. Returns null when the input cannot be parsed,
 * so the caller keeps the CSS default rather than writing a broken value.
 */
function hexToTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}
