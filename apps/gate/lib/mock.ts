/**
 * Mock recognition engine for Liwan Gate.
 *
 * When NEXT_PUBLIC_MOCK=1 (or ?mock=1) the kiosk runs with no camera and no
 * recognition engine: `mockRecognize` returns plausible RecognizeResult objects
 * so the door-open moment and denied states can be demoed anywhere. Weighted so
 * grants dominate, with occasional unknown/denied for a realistic feel.
 */
import type { Decision, Direction, RecognizeResult } from "./types";

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

/** Outcome plan: mostly grants, sprinkled with unknown/denied states. */
type Outcome =
  | { kind: "granted"; direction: Direction }
  | { kind: "unknown_face" }
  | { kind: "not_authorized" }
  | { kind: "off_schedule" };

const OUTCOME_PLAN: readonly Outcome[] = [
  { kind: "granted", direction: "in" },
  { kind: "granted", direction: "in" },
  { kind: "granted", direction: "out" },
  { kind: "unknown_face" },
  { kind: "granted", direction: "in" },
  { kind: "granted", direction: "out" },
  { kind: "not_authorized" },
  { kind: "granted", direction: "in" },
  { kind: "granted", direction: "out" },
  { kind: "off_schedule" },
];

let tick = 0;
let personIdx = 0;

function nextPerson(): MockPerson {
  const p = PEOPLE[personIdx % PEOPLE.length]!;
  personIdx += 1;
  return p;
}

function randomSimilarity(min: number, max: number): number {
  return Number((min + Math.random() * (max - min)).toFixed(3));
}

/**
 * Produce one simulated recognition. Cycles deterministically through the plan
 * so a demo always shows the full range of states within a handful of frames.
 */
export function mockRecognize(): RecognizeResult {
  const outcome = OUTCOME_PLAN[tick % OUTCOME_PLAN.length]!;
  tick += 1;

  if (outcome.kind === "granted") {
    const person = nextPerson();
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
    };
  }

  const decision: Decision = outcome.kind;
  // Unknown faces score below threshold; authz/schedule denials match a person.
  if (decision === "unknown_face") {
    return {
      decision,
      similarity: randomSimilarity(0.4, 0.7),
      door_opened: false,
      direction: "unknown",
    };
  }

  const person = nextPerson();
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
  };
}
