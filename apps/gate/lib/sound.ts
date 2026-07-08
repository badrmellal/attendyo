/**
 * WebAudio chimes for Attendyo Gate — Smart Gate rules v2.1.
 *
 * Pure oscillator tones, no audio assets, no network — fully on-prem:
 * - granted → soft two-note ding (E5 → A5, sine, ~180ms notes, gain ~0.15)
 * - denied (unknown_face / not_authorized / off_schedule / denied)
 *   → single low ~220 Hz tone, ~250ms
 * - no_face → silence (it never reaches here, but guarded anyway)
 *
 * The AudioContext is created lazily on first use and reused. Everything is
 * wrapped: autoplay policies, missing API, or a closed context must NEVER
 * throw into the recognition hot path. Disabled via `?sound=0` /
 * `NEXT_PUBLIC_SOUND=0` (resolved in KioskConfig; callers pass `enabled`).
 */
import type { Decision } from "./types";

const E5 = 659.25;
const A5 = 880;
const LOW = 220;
const PEAK_GAIN = 0.15;

let ctx: AudioContext | null = null;

/** Lazily create (and keep) one AudioContext; null when unavailable. */
function getContext(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (!ctx || ctx.state === "closed") ctx = new AC();
    // Autoplay policies may leave the context suspended until a gesture;
    // resume() is best-effort — a rejected promise is swallowed.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** One enveloped sine blip (soft attack, exponential release — no clicks). */
function tone(
  audio: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/**
 * Play the chime for a decision. Silent for `no_face`, when disabled, or when
 * WebAudio is unavailable/blocked. Never throws.
 */
export function playChime(
  decision: Decision | "no_face",
  enabled: boolean,
): void {
  try {
    if (!enabled) return;
    if (decision === "no_face") return; // silent non-event, end to end
    const audio = getContext();
    if (!audio) return;
    const now = audio.currentTime;
    if (decision === "granted") {
      tone(audio, E5, now, 0.18);
      tone(audio, A5, now + 0.14, 0.18);
    } else {
      tone(audio, LOW, now, 0.25);
    }
  } catch {
    // Autoplay policy / device without audio — the door still opens.
  }
}
