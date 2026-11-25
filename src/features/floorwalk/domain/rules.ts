/**
 * The Standard: the Rules a Site is walked against. Rules are data; the
 * checks that apply them are code (`walk.ts`). The model may only *cite* a
 * Rule; it never decides a Rule's severity, its deadline or the Score.
 */

export type SiteKind = "warehouse" | "retail";
export type Severity = "critical" | "major" | "minor";

export type Rule = {
  id: string;
  /** A few words, for chips and the Fix list. */
  title: string;
  /** The sentence the Rule holds a Site to, shown to the model verbatim. */
  sentence: string;
  severity: Severity;
  /** How soon a Finding against this Rule must be fixed. */
  fixWithinHours: number;
  /** Which kinds of Site it applies to. */
  kinds: readonly SiteKind[];
};

export const RULES: readonly Rule[] = [
  {
    id: "exits-clear",
    title: "Fire exits clear",
    sentence:
      "Fire exit doors, and the floor in front of them, are clear of stock, pallets and boxes.",
    severity: "critical",
    fixWithinHours: 1,
    kinds: ["warehouse", "retail"],
  },
  {
    id: "extinguisher-reachable",
    title: "Extinguishers reachable",
    sentence:
      "Fire extinguishers are visible and nothing is stacked in front of them.",
    severity: "critical",
    fixWithinHours: 1,
    kinds: ["warehouse", "retail"],
  },
  {
    id: "spill-marked",
    title: "Spills marked",
    sentence:
      "A spill or broken glass on the floor is cleaned up, or marked with a yellow wet-floor sign until it is.",
    severity: "major",
    fixWithinHours: 1,
    kinds: ["warehouse", "retail"],
  },
  {
    id: "hi-vis-worn",
    title: "Hi-vis worn",
    sentence: "Everyone on the warehouse floor wears a high-visibility vest.",
    severity: "major",
    fixWithinHours: 0,
    kinds: ["warehouse"],
  },
  {
    id: "cold-door-shut",
    title: "Cold doors shut",
    sentence:
      "Cold room and chiller doors are closed when nobody is going through them; nothing props them open.",
    severity: "major",
    fixWithinHours: 1,
    kinds: ["warehouse", "retail"],
  },
  {
    id: "stock-square",
    title: "Stock square on racks",
    sentence:
      "Stock on a rack sits square inside it; nothing leans out or overhangs the edge.",
    severity: "major",
    fixWithinHours: 4,
    kinds: ["warehouse"],
  },
  {
    id: "aisle-clear",
    title: "Aisles clear",
    sentence:
      "Aisles are free of loose cartons and anything else a person could trip over.",
    severity: "minor",
    fixWithinHours: 4,
    kinds: ["warehouse", "retail"],
  },
  {
    id: "shelves-stocked",
    title: "Shelves stocked",
    sentence:
      "Shelves have no empty bays during opening hours; a gap is refilled or faced up.",
    severity: "minor",
    fixWithinHours: 24,
    kinds: ["retail"],
  },
  {
    id: "price-labelled",
    title: "Prices labelled",
    sentence: "Every shelf edge that holds stock carries price labels.",
    severity: "minor",
    fixWithinHours: 24,
    kinds: ["retail"],
  },
];

/** Points a Finding takes off the Score, by severity. Data, like the Rules. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  major: 10,
  minor: 4,
};

export const SEVERITIES: readonly Severity[] = ["critical", "major", "minor"];

/** A Rule the visitor has edited on the Standard tab: on or off, and its severity. */
export type RuleSetting = { on: boolean; severity: Severity };
export type Standard = Record<string, RuleSetting>;

export function defaultStandard(kind?: SiteKind): Standard {
  return Object.fromEntries(
    RULES.filter((rule) => !kind || rule.kinds.includes(kind)).map((rule) => [
      rule.id,
      { on: true, severity: rule.severity },
    ]),
  );
}

export function ruleById(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id);
}

/** The Rules that apply to a kind of Site, or all of them for an upload. */
export function rulesFor(kind: SiteKind | null): Rule[] {
  return RULES.filter((rule) => !kind || rule.kinds.includes(kind));
}
