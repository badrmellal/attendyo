"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";

/** Imperative handle the page uses to grab a frame on each capture tick. */
export interface CameraHandle {
  /**
   * Capture the current video frame as a JPEG blob.
   * Returns null when the camera is not ready / not granted.
   */
  capture: () => Promise<Blob | null>;
  /** Whether a live camera stream is currently active. */
  isReady: () => boolean;
}

export type CameraStatus = "idle" | "starting" | "ready" | "blocked";

interface CameraViewProps {
  /** Disable getUserMedia entirely (mock mode demos with no camera). */
  mock?: boolean;
  /** Notified when the camera status changes (e.g. to surface a hint). */
  onStatusChange?: (status: CameraStatus) => void;
  /** Tint the gate frame for the active result state. */
  tone?: "idle" | "granted" | "denied";
  className?: string;
}

/** Max captured frame width; downscaled to keep POST bodies small over LAN. */
const CAPTURE_MAX_WIDTH = 640;
const CAPTURE_QUALITY = 0.82;

/**
 * The Attendyo signature: the live camera sits *inside the doorway frame*.
 * The video is clipped to the doorway silhouette and a thick gate frame is stroked
 * over it — gold at idle (with a soft gold sweep tracing the outline), glowing
 * ultramarine when access is granted, flushing rose once when denied. The doorway
 * geometry is shared between the clip-path and the frame so they register exactly.
 *
 * Owns the getUserMedia stream and offscreen capture canvas. In mock mode it
 * renders a calm placeholder instead of requesting the camera.
 */
// Shared doorway path in a 0..100 (x) by 0..133.33 (y) space — a 3:4 viewport.
// A gentle rounded doorway: straight jambs rising well past mid-height, then a
// single shallow, continuous arc into a flat-ish crown — NOT a horseshoe/pointed
// Moroccan arch. A gentle doorway silhouette (see brand/BRAND.md),
// just widened to fill this 3:4 kiosk viewport.
const ARCH_VB_W = 100;
const ARCH_VB_H = 133.333;
const ARCH_PATH =
  "M6 133.333 V30 C6 14.8 26 6 50 6 C74 6 94 14.8 94 30 V133.333";
export const CameraView = forwardRef<CameraHandle, CameraViewProps>(
  function CameraView(
    { mock = false, onStatusChange, tone = "idle", className },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [status, setStatus] = useState<CameraStatus>("idle");

    // Keep the latest onStatusChange without re-running the camera effect.
    const statusCbRef = useRef(onStatusChange);
    statusCbRef.current = onStatusChange;

    const setAndReport = (next: CameraStatus) => {
      setStatus(next);
      statusCbRef.current?.(next);
    };

    useImperativeHandle(
      ref,
      () => ({
        isReady: () => status === "ready",
        capture: async () => {
          const video = videoRef.current;
          if (!video || status !== "ready" || video.readyState < 2) {
            return null;
          }
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) return null;

          const scale = Math.min(1, CAPTURE_MAX_WIDTH / vw);
          const w = Math.round(vw * scale);
          const h = Math.round(vh * scale);

          let canvas = canvasRef.current;
          if (!canvas) {
            canvas = document.createElement("canvas");
            canvasRef.current = canvas;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(video, 0, 0, w, h);

          return await new Promise<Blob | null>((resolve) => {
            canvas!.toBlob(
              (blob) => resolve(blob),
              "image/jpeg",
              CAPTURE_QUALITY,
            );
          });
        },
      }),
      [status],
    );

    useEffect(() => {
      if (mock) {
        setAndReport("idle");
        return;
      }
      let cancelled = false;
      setAndReport("starting");

      const start = async () => {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices?.getUserMedia
        ) {
          if (!cancelled) setAndReport("blocked");
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            // Autoplay on a muted inline video — required on kiosk browsers.
            await video.play().catch(() => undefined);
          }
          setAndReport("ready");
        } catch {
          if (!cancelled) setAndReport("blocked");
        }
      };

      void start();

      return () => {
        cancelled = true;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mock]);

    // The gate frame color follows the recognition phase: gold while idle /
    // scanning, ultramarine on granted, rose on denied.
    const archColor =
      tone === "granted"
        ? "rgb(var(--primary))"
        : tone === "denied"
          ? "rgb(var(--danger))"
          : "rgb(var(--accent))";
    const archGlow =
      tone === "granted"
        ? "drop-shadow(0 0 18px rgb(var(--primary) / 0.55))"
        : tone === "denied"
          ? "drop-shadow(0 0 14px rgb(var(--danger) / 0.5))"
          : "drop-shadow(0 0 10px rgb(var(--accent) / 0.28))";

    return (
      <div
        className={cn(
          "relative aspect-[3/4] w-full",
          tone === "denied" && "animate-calm-shake",
          className,
        )}
      >
        {/* SVG defs: the gate clip-path that masks the video into the doorway. */}
        <svg
          className="pointer-events-none absolute h-0 w-0"
          aria-hidden="true"
        >
          <defs>
            <clipPath id="attendyo-gate-clip" clipPathUnits="objectBoundingBox">
              {/* Same doorway, normalized to 0..1 so it scales with the box. */}
              <path
                d={`${ARCH_PATH} H6 Z`}
                transform={`scale(${1 / ARCH_VB_W} ${1 / ARCH_VB_H})`}
              />
            </clipPath>
          </defs>
        </svg>

        {/* The clipped video / placeholder — the face sits inside the gate. */}
        <div
          className="absolute inset-0 bg-surface"
          style={{ clipPath: "url(#attendyo-gate-clip)" }}
        >
          {!mock && (
            <video
              ref={videoRef}
              className="h-full w-full scale-x-[-1] object-cover"
              muted
              playsInline
              autoPlay
            />
          )}

          {mock && (
            // Calm placeholder for camera-free demos — a soft riad-night field.
            <div
              className="h-full w-full"
              style={{
                background:
                  "radial-gradient(80% 60% at 50% 38%, rgb(var(--surface-2)) 0%, rgb(var(--bg)) 78%)",
              }}
              aria-hidden="true"
            />
          )}

          {/* Thin scanning guide sweeping the viewport, in brand ultramarine. */}
          <div
            className="absolute inset-x-[12%] h-px animate-scan"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(var(--primary)), transparent)",
              boxShadow: "0 0 14px 1px rgb(var(--primary) / 0.45)",
            }}
          />
        </div>

        {/* The gate frame, stroked over the video and registered to the clip. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${ARCH_VB_W} ${ARCH_VB_H}`}
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
          style={{ filter: archGlow, transition: "filter 300ms ease" }}
        >
          {/* Solid gate frame — thick, takes the active phase color. */}
          <path
            d={ARCH_PATH}
            stroke={archColor}
            strokeWidth={tone === "idle" ? 2.4 : 3.2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ transition: "stroke 320ms ease, stroke-width 320ms ease" }}
          />
          {/* Idle/scanning: a soft gold sweep travelling along the outline. */}
          {tone === "idle" && (
            <path
              d={ARCH_PATH}
              stroke="rgb(var(--accent))"
              strokeWidth={3.4}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={100}
              className="animate-gate-sweep"
              style={{ strokeDasharray: "18 82" }}
            />
          )}
        </svg>
      </div>
    );
  },
);
