/**
 * Offline voice for Attendyo Gate — Smart Gate rules v2.1.
 *
 * Speaks the greeting (and the one-shot door-side message, when present) via
 * the browser's built-in `window.speechSynthesis`. Fully on-prem: no cloud
 * TTS, no audio assets, no network.
 *
 * Guarantees:
 * - NEVER throws — every entry point is wrapped; a missing API, an autoplay
 *   policy, or a voice-list quirk must not touch the recognition hot path.
 * - No pile-up: any queued utterance is cancelled before a new one starts.
 * - Voice matches `branding.locale` (first voice whose `lang` starts with the
 *   locale); silently falls back to the platform default voice otherwise.
 * - Disabled via `?voice=0` / `NEXT_PUBLIC_VOICE=0` (resolved in KioskConfig;
 *   callers pass `enabled`).
 */
import { localeTag } from "./branding";
import type { Locale } from "./types";

const RATE = 1.0;
const VOLUME = 0.9;

/** Localized spoken prefix for the door-side message ("Message : …"). */
const MESSAGE_PREFIX: Record<Locale, string> = {
  fr: "Message : ",
  en: "Message: ",
  ar: "رسالة: ",
};

export interface SpeakOptions {
  /** The greeting line exactly as displayed (server-verbatim or fallback). */
  greeting?: string;
  /** One-shot door-side message; read after the greeting when present. */
  message?: string;
  /** branding.locale — drives voice selection and the message prefix. */
  locale: Locale;
  /** Kiosk voice flag (?voice=0 / NEXT_PUBLIC_VOICE=0 turn it off). */
  enabled: boolean;
}

/**
 * Speak a granted result: greeting first, then "Message : …" when a door-side
 * note is attached. No-op when disabled, when speechSynthesis is missing, or
 * when there is nothing to say. Never throws.
 */
export function speakGreeting(opts: SpeakOptions): void {
  try {
    if (!opts.enabled) return;
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    const phrases: string[] = [];
    const greeting = opts.greeting?.trim();
    if (greeting) phrases.push(greeting);
    const message = opts.message?.trim();
    if (message) phrases.push(`${MESSAGE_PREFIX[opts.locale]}${message}`);
    if (phrases.length === 0) return;

    // Cancel anything still queued or speaking — back-to-back recognitions
    // must not stack greetings.
    synth.cancel();

    const voice = pickVoice(synth, opts.locale);
    for (const text of phrases) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = localeTag(opts.locale);
      if (voice) utterance.voice = voice;
      utterance.rate = RATE;
      utterance.volume = VOLUME;
      synth.speak(utterance);
    }
  } catch {
    // Voice is a garnish; the door must keep working without it.
  }
}

/**
 * First installed voice whose BCP-47 lang starts with the locale ("fr" matches
 * "fr-FR", "fr-CA", …). `getVoices()` can legitimately be empty until the
 * platform loads its list — return undefined and let the default voice speak.
 */
function pickVoice(
  synth: SpeechSynthesis,
  locale: Locale,
): SpeechSynthesisVoice | undefined {
  try {
    return synth
      .getVoices()
      .find((v) => v.lang.toLowerCase().startsWith(locale));
  } catch {
    return undefined;
  }
}
