/**
 * Lightweight UI string table.
 *
 * The brand voice is French-first for the Moroccan market, with English and
 * Arabic locales. Strings here are UI chrome only; all brand-identifying text
 * (product name, tagline) still comes from the branding tokens, never hardcoded.
 */

import type { AccessDecision, AttendanceStatus, Locale } from "./types";

type Dict = Record<string, string>;

const STRINGS: Record<Locale, Dict> = {
  fr: {
    "nav.dashboard": "Tableau de bord",
    "nav.people": "Personnes",
    "nav.attendance": "Présence",
    "nav.monitor": "Surveillance",
    "nav.doors": "Portes & caméras",
    "nav.settings": "Paramètres",
    "nav.section.overview": "Vue d'ensemble",
    "nav.section.access": "Contrôle d'accès",
    "nav.section.admin": "Administration",
    "common.search": "Rechercher",
    "common.export": "Exporter CSV",
    "common.signout": "Déconnexion",
    "common.today": "Aujourd'hui",
    "common.all": "Tous",
    "common.cancel": "Annuler",
    "common.save": "Enregistrer",
    "common.loading": "Chargement…",
    "stat.present": "Présents",
    "stat.late": "En retard",
    "stat.absent": "Absents",
    "stat.onsite": "Sur site",
    "stat.denied": "Refus aujourd'hui",
    "login.welcome": "Bon retour",
    "login.subtitle": "Connectez-vous pour gérer l'accès et la présence.",
    "login.email": "Adresse e-mail",
    "login.password": "Mot de passe",
    "login.submit": "Se connecter",
  },
  en: {
    "nav.dashboard": "Dashboard",
    "nav.people": "People",
    "nav.attendance": "Attendance",
    "nav.monitor": "Monitor",
    "nav.doors": "Doors & cameras",
    "nav.settings": "Settings",
    "nav.section.overview": "Overview",
    "nav.section.access": "Access control",
    "nav.section.admin": "Administration",
    "common.search": "Search",
    "common.export": "Export CSV",
    "common.signout": "Sign out",
    "common.today": "Today",
    "common.all": "All",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.loading": "Loading…",
    "stat.present": "Present",
    "stat.late": "Late",
    "stat.absent": "Absent",
    "stat.onsite": "On site now",
    "stat.denied": "Denied today",
    "login.welcome": "Welcome back",
    "login.subtitle": "Sign in to manage access and attendance.",
    "login.email": "Email address",
    "login.password": "Password",
    "login.submit": "Sign in",
  },
  ar: {
    "nav.dashboard": "لوحة القيادة",
    "nav.people": "الأشخاص",
    "nav.attendance": "الحضور",
    "nav.monitor": "المراقبة",
    "nav.doors": "الأبواب والكاميرات",
    "nav.settings": "الإعدادات",
    "nav.section.overview": "نظرة عامة",
    "nav.section.access": "التحكم في الوصول",
    "nav.section.admin": "الإدارة",
    "common.search": "بحث",
    "common.export": "تصدير CSV",
    "common.signout": "تسجيل الخروج",
    "common.today": "اليوم",
    "common.all": "الكل",
    "common.cancel": "إلغاء",
    "common.save": "حفظ",
    "common.loading": "جار التحميل…",
    "stat.present": "حاضرون",
    "stat.late": "متأخرون",
    "stat.absent": "غائبون",
    "stat.onsite": "في الموقع",
    "stat.denied": "رفض اليوم",
    "login.welcome": "مرحبًا بعودتك",
    "login.subtitle": "سجّل الدخول لإدارة الوصول والحضور.",
    "login.email": "البريد الإلكتروني",
    "login.password": "كلمة المرور",
    "login.submit": "تسجيل الدخول",
  },
};

export function t(locale: Locale, key: string): string {
  return STRINGS[locale]?.[key] ?? STRINGS.fr[key] ?? key;
}

/** Human label for a decision, per locale. */
export function decisionLabel(locale: Locale, decision: AccessDecision): string {
  const map: Record<Locale, Record<AccessDecision, string>> = {
    fr: {
      granted: "Autorisé",
      denied: "Refusé",
      unknown_face: "Visage inconnu",
      not_authorized: "Non autorisé",
      off_schedule: "Hors horaire",
    },
    en: {
      granted: "Granted",
      denied: "Denied",
      unknown_face: "Unknown face",
      not_authorized: "Not authorized",
      off_schedule: "Off schedule",
    },
    ar: {
      granted: "مسموح",
      denied: "مرفوض",
      unknown_face: "وجه غير معروف",
      not_authorized: "غير مخوّل",
      off_schedule: "خارج الجدول",
    },
  };
  return map[locale]?.[decision] ?? map.en[decision];
}

/** Human label for an attendance status, per locale. */
export function statusLabel(locale: Locale, status: AttendanceStatus): string {
  const map: Record<Locale, Record<AttendanceStatus, string>> = {
    fr: { present: "Présent", late: "En retard", absent: "Absent", incomplete: "Incomplet" },
    en: { present: "Present", late: "Late", absent: "Absent", incomplete: "Incomplete" },
    ar: { present: "حاضر", late: "متأخر", absent: "غائب", incomplete: "غير مكتمل" },
  };
  return map[locale]?.[status] ?? map.en[status];
}
