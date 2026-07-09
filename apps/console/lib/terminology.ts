/**
 * Terminology presets (white-label verticals) — locale-aware.
 *
 * `branding.terminology` ("workforce" | "campus" | "residence") relabels the
 * Console for the customer vertical — an enterprise, a university campus, or a
 * residence — without any rebuild. Every label is provided in all three UI
 * locales (fr/en/ar); `terminologyLabels(preset, locale)` resolves the active
 * one. The API stores the preset only. Consumed via `useBranding().term`
 * (BrandingProvider recomputes on settings/locale change).
 *
 * NOTE: Arabic strings are MSA and should get a native-speaker review.
 */

import type { Locale, MemberType, Terminology } from "./types";

export type TerminologyLabels = {
  /** Sidebar / page-title label for the people section. */
  peopleNav: string;
  /** "personne" — used in counters and empty states. */
  personSingular: string;
  /** "personnes" */
  personPlural: string;
  /** Column / field label replacing "Département". */
  departmentLabel: string;
  /** The department filter's all-option ("Tous départements"). */
  departmentAll: string;
  /** Dashboard "N … actifs" suffix. */
  activeCountLabel: string;
  /** Member types in display order — the vertical's own types come first. */
  memberTypeOrder: MemberType[];
  /** Labels for every member type, in the active locale. */
  memberTypeLabels: Record<MemberType, string>;
};

const LOCALES: Locale[] = ["fr", "en", "ar"];

/** Base member-type labels per locale (shared by every preset). */
const TYPE_LABELS: Record<Locale, Record<MemberType, string>> = {
  fr: {
    employee: "Employé",
    resident: "Résident",
    contractor: "Prestataire",
    visitor: "Visiteur",
    student: "Étudiant",
    faculty: "Enseignant",
    staff: "Personnel",
  },
  en: {
    employee: "Employee",
    resident: "Resident",
    contractor: "Contractor",
    visitor: "Visitor",
    student: "Student",
    faculty: "Faculty",
    staff: "Staff",
  },
  ar: {
    employee: "موظف",
    resident: "ساكن",
    contractor: "مقاول",
    visitor: "زائر",
    student: "طالب",
    faculty: "أستاذ",
    staff: "طاقم",
  },
};

type PresetL10n = {
  peopleNav: string;
  personSingular: string;
  personPlural: string;
  departmentLabel: string;
  departmentAll: string;
  activeCountLabel: string;
  /** Per-preset overrides of specific member-type labels (e.g. campus staff). */
  typeOverrides?: Partial<Record<MemberType, string>>;
};

type PresetDef = {
  memberTypeOrder: MemberType[];
  l10n: Record<Locale, PresetL10n>;
};

const PRESETS: Record<Terminology, PresetDef> = {
  workforce: {
    memberTypeOrder: ["employee", "contractor", "visitor", "resident", "student", "faculty", "staff"],
    l10n: {
      fr: {
        peopleNav: "Personnes",
        personSingular: "personne",
        personPlural: "personnes",
        departmentLabel: "Département",
        departmentAll: "Tous départements",
        activeCountLabel: "membres actifs",
      },
      en: {
        peopleNav: "People",
        personSingular: "person",
        personPlural: "people",
        departmentLabel: "Department",
        departmentAll: "All departments",
        activeCountLabel: "active members",
      },
      ar: {
        peopleNav: "الأشخاص",
        personSingular: "شخص",
        personPlural: "أشخاص",
        departmentLabel: "القسم",
        departmentAll: "كل الأقسام",
        activeCountLabel: "عضو نشط",
      },
    },
  },
  campus: {
    memberTypeOrder: ["student", "faculty", "staff", "employee", "contractor", "visitor", "resident"],
    l10n: {
      fr: {
        peopleNav: "Étudiants & Personnel",
        personSingular: "personne",
        personPlural: "personnes",
        departmentLabel: "Faculté / École",
        departmentAll: "Toutes facultés",
        activeCountLabel: "étudiants & personnel actifs",
        typeOverrides: { staff: "Personnel administratif" },
      },
      en: {
        peopleNav: "Students & Staff",
        personSingular: "person",
        personPlural: "people",
        departmentLabel: "Faculty / School",
        departmentAll: "All faculties",
        activeCountLabel: "active students & staff",
        typeOverrides: { staff: "Administrative staff" },
      },
      ar: {
        peopleNav: "الطلاب والموظفون",
        personSingular: "شخص",
        personPlural: "أشخاص",
        departmentLabel: "الكلية / المدرسة",
        departmentAll: "كل الكليات",
        activeCountLabel: "طلاب وموظفون نشطون",
        typeOverrides: { staff: "طاقم إداري" },
      },
    },
  },
  residence: {
    memberTypeOrder: ["resident", "visitor", "employee", "contractor", "staff", "student", "faculty"],
    l10n: {
      fr: {
        peopleNav: "Résidents",
        personSingular: "résident",
        personPlural: "résidents",
        departmentLabel: "Immeuble / Bâtiment",
        departmentAll: "Tous bâtiments",
        activeCountLabel: "résidents actifs",
      },
      en: {
        peopleNav: "Residents",
        personSingular: "resident",
        personPlural: "residents",
        departmentLabel: "Building",
        departmentAll: "All buildings",
        activeCountLabel: "active residents",
      },
      ar: {
        peopleNav: "السكان",
        personSingular: "ساكن",
        personPlural: "سكان",
        departmentLabel: "المبنى",
        departmentAll: "كل المباني",
        activeCountLabel: "ساكن نشط",
      },
    },
  },
};

/** Localized preset display names for the Settings selector. */
export const TERMINOLOGY_PRESETS: Record<
  Locale,
  { value: Terminology; label: string; hint: string }[]
> = {
  fr: [
    { value: "workforce", label: "Entreprise", hint: "Employés · Département · Prestataires" },
    { value: "campus", label: "Campus", hint: "Étudiants & Personnel · Faculté / École" },
    { value: "residence", label: "Résidence", hint: "Résidents · Immeuble / Bâtiment" },
  ],
  en: [
    { value: "workforce", label: "Enterprise", hint: "Employees · Department · Contractors" },
    { value: "campus", label: "Campus", hint: "Students & Staff · Faculty / School" },
    { value: "residence", label: "Residence", hint: "Residents · Building" },
  ],
  ar: [
    { value: "workforce", label: "مؤسسة", hint: "موظفون · قسم · مقاولون" },
    { value: "campus", label: "حرم جامعي", hint: "طلاب وموظفون · كلية / مدرسة" },
    { value: "residence", label: "سكن", hint: "سكان · مبنى" },
  ],
};

/** Preset selector rows for the active locale (fallback to fr). */
export function terminologyPresetOptions(locale?: Locale | null) {
  return TERMINOLOGY_PRESETS[locale ?? "fr"] ?? TERMINOLOGY_PRESETS.fr;
}

/** Resolve labels for a preset + locale; unknowns fall back to workforce/fr. */
export function terminologyLabels(
  preset?: Terminology | null,
  locale?: Locale | null,
): TerminologyLabels {
  const def = PRESETS[preset ?? "workforce"] ?? PRESETS.workforce;
  const loc: Locale = locale && LOCALES.includes(locale) ? locale : "fr";
  const l = def.l10n[loc];
  return {
    peopleNav: l.peopleNav,
    personSingular: l.personSingular,
    personPlural: l.personPlural,
    departmentLabel: l.departmentLabel,
    departmentAll: l.departmentAll,
    activeCountLabel: l.activeCountLabel,
    memberTypeOrder: def.memberTypeOrder,
    memberTypeLabels: { ...TYPE_LABELS[loc], ...(l.typeOverrides ?? {}) },
  };
}

/** Ordered {value, label} pairs for member-type selects and filters. */
export function memberTypeOptions(
  term: TerminologyLabels,
): { value: MemberType; label: string }[] {
  return term.memberTypeOrder.map((value) => ({ value, label: term.memberTypeLabels[value] }));
}
