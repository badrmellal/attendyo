/**
 * Branding + localization for Attendyo Gate.
 *
 * Defaults come from brand/BRAND.md and db/schema.sql's seeded `branding` row.
 * At runtime the real values are read from GET /api/settings → branding, so the
 * kiosk is fully white-label: never hard-code the product name or colors in a
 * way that blocks rebranding.
 */
import type { Branding, Direction, Locale } from "./types";

/** Fallback branding — matches the seeded settings in db/schema.sql. */
export const DEFAULT_BRANDING: Branding = {
  product_name: "Attendyo",
  tagline: "The face is the key.",
  primary_color: "#5663F2",
  accent_color: "#E0A340",
  logo_url: null,
  locale: "fr",
};

/** Locales that render right-to-left. */
const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

/** Normalize an arbitrary string to a supported locale, defaulting to `fr`. */
export function normalizeLocale(value: string | undefined | null): Locale {
  switch ((value ?? "").toLowerCase()) {
    case "en":
      return "en";
    case "ar":
      return "ar";
    case "fr":
    default:
      return "fr";
  }
}

/** BCP-47 tag for Intl date/time formatting per locale. */
export function localeTag(locale: Locale): string {
  switch (locale) {
    case "en":
      return "en-GB";
    case "ar":
      return "ar-MA";
    case "fr":
    default:
      return "fr-MA";
  }
}

/** All translatable strings used by the kiosk. */
export interface Strings {
  lookHint: string;
  welcome: (name: string) => string;
  checkIn: string;
  checkOut: string;
  present: string;
  doorOpen: string;
  unknownFace: string;
  notAuthorized: string;
  offSchedule: string;
  denied: string;
  /** Validity window ended (reason "expired" on a not_authorized decision). */
  expired: string;
  /** Validity window not started yet (reason "not_yet_valid"). */
  notYetValid: string;
  /** Idle-footer privacy statement — on-prem processing, nothing leaves the site. */
  privacyLine: string;
  cameraBlocked: string;
  cameraBlockedHint: string;
  connecting: string;
}

const STRINGS: Record<Locale, Strings> = {
  fr: {
    lookHint: "Regardez la caméra",
    welcome: (name) => `Bienvenue ${name}`,
    checkIn: "Entrée",
    checkOut: "Sortie",
    present: "Présence enregistrée",
    doorOpen: "Porte ouverte",
    unknownFace: "Visage non reconnu",
    notAuthorized: "Accès non autorisé",
    offSchedule: "Hors plage horaire",
    denied: "Accès refusé",
    expired: "Accès expiré — contactez l'accueil",
    notYetValid: "Accès pas encore actif — contactez l'accueil",
    privacyLine:
      "Traitement 100 % local — vos données ne quittent pas le site.",
    cameraBlocked: "Caméra indisponible",
    cameraBlockedHint: "Autorisez l'accès à la caméra pour ce terminal.",
    connecting: "Connexion…",
  },
  en: {
    lookHint: "Look at the camera",
    welcome: (name) => `Welcome ${name}`,
    checkIn: "Check-in",
    checkOut: "Check-out",
    present: "Attendance recorded",
    doorOpen: "Door open",
    unknownFace: "Face not recognized",
    notAuthorized: "Access not authorized",
    offSchedule: "Outside schedule",
    denied: "Access denied",
    expired: "Access expired — please see reception",
    notYetValid: "Access not yet active — please see reception",
    privacyLine: "100% local processing — your data never leaves the site.",
    cameraBlocked: "Camera unavailable",
    cameraBlockedHint: "Allow camera access for this terminal.",
    connecting: "Connecting…",
  },
  ar: {
    lookHint: "انظر إلى الكاميرا",
    welcome: (name) => `مرحباً ${name}`,
    checkIn: "دخول",
    checkOut: "خروج",
    present: "تم تسجيل الحضور",
    doorOpen: "الباب مفتوح",
    unknownFace: "وجه غير معروف",
    notAuthorized: "الدخول غير مصرح به",
    offSchedule: "خارج أوقات الدوام",
    denied: "تم رفض الدخول",
    expired: "انتهت صلاحية الدخول — يرجى مراجعة الاستقبال",
    notYetValid: "الدخول غير مفعّل بعد — يرجى مراجعة الاستقبال",
    privacyLine: "معالجة محلية 100٪ — بياناتك لا تغادر الموقع.",
    cameraBlocked: "الكاميرا غير متاحة",
    cameraBlockedHint: "اسمح بالوصول إلى الكاميرا لهذا الجهاز.",
    connecting: "جارٍ الاتصال…",
  },
};

export function getStrings(locale: Locale): Strings {
  return STRINGS[locale];
}

/** Human label for a movement direction, defaulting to check-in. */
export function directionLabel(direction: Direction, s: Strings): string {
  if (direction === "out") return s.checkOut;
  if (direction === "in") return s.checkIn;
  // `unknown` direction at a single-door site still represents a presence mark.
  return s.checkIn;
}
