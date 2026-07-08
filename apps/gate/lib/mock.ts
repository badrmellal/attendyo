/**
 * Mock recognition engine for Attendyo Gate.
 *
 * When NEXT_PUBLIC_MOCK=1 (or ?mock=1) the kiosk runs with no camera and no
 * recognition engine: `mockRecognize` returns plausible RecognizeResult objects
 * so the v2.1 Smart Gate flow can be demoed anywhere:
 *
 * - Mostly `no_face` — the realistic idle state (empty hallway between people);
 *   the kiosk must stay silent on these (bug #1: no red "Visage non reconnu").
 * - A granted "in" then a granted "out" for the SAME person, so the demo shows
 *   the goodbye path (bug #2): "Au revoir {name}" + Sortie chip + day_summary.
 * - One granted entry carrying a one-shot door-side `message` (the gold card).
 * - The existing unknown/expired/off-schedule denial cases.
 *
 * Grants carry `greeting` / `day_summary` / `message` strings exactly like the
 * server would, so the display goes through the same server-verbatim path.
 */
import type { Decision, RecognizeResult } from "./types";

interface MockPerson {
  id: string;
  full_name: string;
  department: string;
  title: string;
}

const PEOPLE: readonly MockPerson[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    full_name: "Yassine El Amrani",
    department: "Direction",
    title: "Directeur Général",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    full_name: "Salma Bennani",
    department: "Ressources Humaines",
    title: "Responsable RH",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    full_name: "Omar Tazi",
    department: "Sécurité",
    title: "Agent de sécurité",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    full_name: "Khadija Idrissi",
    department: "Finance",
    title: "Comptable",
  },
  {
    id: "55555555-5555-5555-5555-555555555555",
    full_name: "Mehdi Chraibi",
    department: "Informatique",
    title: "Administrateur Système",
  },
];

/** One step of the demo storyline. `person` indexes PEOPLE. */
type Outcome =
  | { kind: "no_face" }
  | {
      kind: "granted";
      direction: "in" | "out";
      person: number;
      day_summary?: string;
      message?: string;
    }
  | { kind: "unknown_face" }
  | { kind: "not_authorized"; person: number; reason?: "expired" | "not_yet_valid" }
  | { kind: "off_schedule"; person: number };

/**
 * The demo plan. no_face dominates (as it does at a real door), and the
 * in → out pairs reuse the same person so exits read as real exits.
 */
const OUTCOME_PLAN: readonly Outcome[] = [
  { kind: "no_face" },
  { kind: "no_face" },
  { kind: "no_face" },
  // Yassine arrives…
  { kind: "granted", direction: "in", person: 0 },
  { kind: "no_face" },
  { kind: "no_face" },
  // …and later leaves: goodbye + Sortie chip + day summary (bug #2 showcase).
  {
    kind: "granted",
    direction: "out",
    person: 0,
    day_summary: "8 h 12 sur site aujourd'hui",
  },
  { kind: "no_face" },
  { kind: "no_face" },
  // Salma enters and finds the one-shot door-side note (the gold card).
  {
    kind: "granted",
    direction: "in",
    person: 1,
    message: "Réunion déplacée à 14 h — salle B",
  },
  { kind: "no_face" },
  { kind: "no_face" },
  // A stranger: the ONLY case that may say "Visage non reconnu".
  { kind: "unknown_face" },
  { kind: "no_face" },
  { kind: "no_face" },
  { kind: "granted", direction: "in", person: 2 },
  { kind: "no_face" },
  // Validity-window denial (v2): a visitor/contractor whose access has expired.
  { kind: "not_authorized", person: 3, reason: "expired" },
  { kind: "no_face" },
  { kind: "no_face" },
  // Omar leaves too — a second same-person exit with its own day summary.
  {
    kind: "granted",
    direction: "out",
    person: 2,
    day_summary: "7 h 45 sur site aujourd'hui",
  },
  { kind: "no_face" },
  { kind: "off_schedule", person: 4 },
  { kind: "no_face" },
  { kind: "no_face" },
  // Validity-window denial (v2): access starts in the future (not yet valid).
  { kind: "not_authorized", person: 3, reason: "not_yet_valid" },
  { kind: "no_face" },
  { kind: "not_authorized", person: 4 },
  { kind: "no_face" },
  { kind: "no_face" },
];

let tick = 0;

function personAt(index: number): MockPerson {
  return PEOPLE[index % PEOPLE.length]!;
}

function firstName(fullName: string): string {
  return fullName.split(/\s+/)[0] ?? fullName;
}

/**
 * Entry greeting exactly as the server builds it (Smart Gate rules, fr):
 * time-aware — "Bonjour" before noon, "Bonsoir" from 18:00, else "Bienvenue".
 */
function entryGreeting(name: string, hour: number): string {
  if (hour < 12) return `Bonjour ${name}`;
  if (hour >= 18) return `Bonsoir ${name}`;
  return `Bienvenue ${name}`;
}

function randomSimilarity(min: number, max: number): number {
  return Number((min + Math.random() * (max - min)).toFixed(3));
}

/**
 * Produce one simulated recognition. Cycles deterministically through the plan
 * so a demo always shows the full range of states within a couple of minutes.
 */
export function mockRecognize(): RecognizeResult {
  const outcome = OUTCOME_PLAN[tick % OUTCOME_PLAN.length]!;
  tick += 1;

  // Empty frame: wire-only non-event — mirrors the API's minimal payload.
  if (outcome.kind === "no_face") {
    return { decision: "no_face", door_opened: false, direction: "unknown" };
  }

  if (outcome.kind === "granted") {
    const person = personAt(outcome.person);
    const name = firstName(person.full_name);
    const greeting =
      outcome.direction === "out"
        ? `Au revoir ${name}`
        : entryGreeting(name, new Date().getHours());
    return {
      decision: "granted",
      member: {
        id: person.id,
        full_name: person.full_name,
        department: person.department,
        title: person.title,
      },
      similarity: randomSimilarity(0.9, 0.99),
      door_opened: true,
      direction: outcome.direction,
      greeting,
      day_summary: outcome.day_summary,
      message: outcome.message,
    };
  }

  const decision: Decision = outcome.kind;
  // Unknown faces score below threshold; authz/schedule denials match a person.
  if (outcome.kind === "unknown_face") {
    return {
      decision,
      similarity: randomSimilarity(0.4, 0.7),
      door_opened: false,
      direction: "unknown",
    };
  }

  const person = personAt(outcome.person);
  return {
    decision,
    member: {
      id: person.id,
      full_name: person.full_name,
      department: person.department,
      title: person.title,
    },
    similarity: randomSimilarity(0.9, 0.98),
    door_opened: false,
    direction: "unknown",
    // Validity-window denials carry a machine reason the UI localizes.
    reason: outcome.kind === "not_authorized" ? outcome.reason : undefined,
  };
}
