/**
 * Terminology presets (white-label verticals).
 *
 * `branding.terminology` ("workforce" | "campus" | "residence") relabels the
 * Console for the customer vertical — an enterprise, a university campus, or a
 * residence — without any rebuild. The API stores the preset only; every label
 * lives here, FR-first like the rest of the UI. Consumed via
 * `useBranding().term` (BrandingProvider recomputes on settings change).
 */

import type { MemberType, Terminology } from "./types";

export type TerminologyLabels = {
  /** Sidebar / page-title label for the people section. */
  peopleNav: string;
  /** "personne" — used in counters and empty states. */
  personSingular: string;
  /** "personnes" */
  personPlural: string;
  /** Column / field label replacing "Département". */
  departmentLabel: string;
  /** "Tous départements" — the department filter's all-option. */
  departmentAll: string;
  /** Dashboard "N … actifs" suffix. */
  activeCountLabel: string;
  /** Member types in display order — the vertical's own types come first. */
  memberTypeOrder: MemberType[];
  /** FR labels for every member type. */
  memberTypeLabels: Record<MemberType, string>;
};

/** Base FR labels shared by every preset. */
const BASE_TYPE_LABELS: Record<MemberType, string> = {
  employee: "Employé",
  resident: "Résident",
  contractor: "Prestataire",
  visitor: "Visiteur",
  student: "Étudiant",
  faculty: "Enseignant",
  staff: "Personnel",
};

const PRESETS: Record<Terminology, TerminologyLabels> = {
  workforce: {
    peopleNav: "Personnes",
    personSingular: "personne",
    personPlural: "personnes",
    departmentLabel: "Département",
    departmentAll: "Tous départements",
    activeCountLabel: "membres actifs",
    memberTypeOrder: [
      "employee",
      "contractor",
      "visitor",
      "resident",
      "student",
      "faculty",
      "staff",
    ],
    memberTypeLabels: BASE_TYPE_LABELS,
  },
  campus: {
    peopleNav: "Étudiants & Personnel",
    personSingular: "personne",
    personPlural: "personnes",
    departmentLabel: "Faculté / École",
    departmentAll: "Toutes facultés",
    activeCountLabel: "étudiants & personnel actifs",
    memberTypeOrder: [
      "student",
      "faculty",
      "staff",
      "employee",
      "contractor",
      "visitor",
      "resident",
    ],
    memberTypeLabels: {
      ...BASE_TYPE_LABELS,
      staff: "Personnel administratif",
    },
  },
  residence: {
    peopleNav: "Résidents",
    personSingular: "résident",
    personPlural: "résidents",
    departmentLabel: "Immeuble / Bâtiment",
    departmentAll: "Tous bâtiments",
    activeCountLabel: "résidents actifs",
    memberTypeOrder: [
      "resident",
      "visitor",
      "employee",
      "contractor",
      "staff",
      "student",
      "faculty",
    ],
    memberTypeLabels: BASE_TYPE_LABELS,
  },
};

/** FR display names for the presets themselves (Settings selector). */
export const TERMINOLOGY_PRESETS: { value: Terminology; label: string; hint: string }[] = [
  { value: "workforce", label: "Entreprise", hint: "Employés · Département · Prestataires" },
  { value: "campus", label: "Campus", hint: "Étudiants & Personnel · Faculté / École" },
  { value: "residence", label: "Résidence", hint: "Résidents · Immeuble / Bâtiment" },
];

/** Resolve labels for a preset; unknown/missing presets fall back to workforce. */
export function terminologyLabels(preset?: Terminology | null): TerminologyLabels {
  return PRESETS[preset ?? "workforce"] ?? PRESETS.workforce;
}

/** Ordered {value, label} pairs for member-type selects and filters. */
export function memberTypeOptions(
  term: TerminologyLabels,
): { value: MemberType; label: string }[] {
  return term.memberTypeOrder.map((value) => ({ value, label: term.memberTypeLabels[value] }));
}
