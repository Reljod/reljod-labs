import { z } from "zod";

/*
 * Rules are data; Checks are code. A Rule names one thing the Process or the
 * Deck must satisfy and carries the numbers a person may change (its
 * Parameters). The code that applies a Rule lives in `process-checks.ts` and
 * `deck-checks.ts`, keyed by the Rule's id. An Owner's edits are stored as
 * overrides on top of these defaults, and every Run records the Rules it used.
 */

export const RULE_GROUPS = {
  process: {
    label: "Process",
    hint: "What the written steps must contain before anything is drafted",
  },
  layout: {
    label: "Deck layout",
    hint: "Alignment, spacing and legibility of every slide",
  },
  content: {
    label: "Deck content",
    hint: "How much a slide may say, and what the deck must cover",
  },
  motion: {
    label: "Deck motion",
    hint: "Transitions between slides and how elements arrive",
  },
  loop: {
    label: "Review loop",
    hint: "How the deck is reviewed and revised before it is approved",
  },
} as const;
export type RuleGroup = keyof typeof RULE_GROUPS;

/** `block` stops Approval; `warn` is reported and does not. */
export type Severity = "block" | "warn";

export type ParamDef = {
  key: string;
  label: string;
  type: "number";
  min: number;
  max: number;
  step: number;
  unit?: string;
};

export type RuleDef = {
  id: string;
  group: RuleGroup;
  title: string;
  /** One sentence a non-technical person can act on. May name Parameters as `{key}`. */
  description: string;
  severity: Severity;
  enabled: boolean;
  params: ParamDef[];
  defaults: Record<string, number>;
};

const num = (
  key: string,
  label: string,
  min: number,
  max: number,
  step = 1,
  unit?: string,
): ParamDef => ({ key, label, type: "number", min, max, step, unit });

const rule = (
  id: string,
  group: RuleGroup,
  severity: Severity,
  title: string,
  description: string,
  params: ParamDef[] = [],
  defaults: Record<string, number> = {},
): RuleDef => ({
  id,
  group,
  title,
  description,
  severity,
  enabled: true,
  params,
  defaults,
});

export const RULES: RuleDef[] = [
  // Process ----------------------------------------------------------------
  rule(
    "process.purpose-and-trigger",
    "process",
    "block",
    "States why and when",
    "The Process says what it is for and what starts it.",
  ),
  rule(
    "process.step-count",
    "process",
    "block",
    "A workable number of steps",
    "Between {min} and {max} steps. Fewer is a summary, more is two processes.",
    [num("min", "At least", 1, 10), num("max", "At most", 5, 40)],
    { min: 3, max: 20 },
  ),
  rule(
    "process.step-has-actor",
    "process",
    "block",
    "Every step names who does it",
    "Each step has a role responsible for it, and that role is listed under Roles.",
  ),
  rule(
    "process.step-starts-with-verb",
    "process",
    "warn",
    "Steps read as instructions",
    "Each step title starts with a verb and has at most {maxWords} words.",
    [num("maxWords", "Title words", 3, 16)],
    { maxWords: 8 },
  ),
  rule(
    "process.step-has-evidence",
    "process",
    "block",
    "Every step points at the recording",
    "Each step carries a time inside the Recording where it was shown.",
  ),
  rule(
    "process.steps-in-order",
    "process",
    "warn",
    "Steps follow the recording",
    "Step times do not run backwards by more than {toleranceSeconds} seconds.",
    [num("toleranceSeconds", "Tolerance", 0, 120, 5, "s")],
    { toleranceSeconds: 15 },
  ),
  rule(
    "process.step-length",
    "process",
    "warn",
    "Steps stay short",
    "A step's instruction has at most {maxWords} words.",
    [num("maxWords", "Instruction words", 20, 150, 5)],
    { maxWords: 60 },
  ),
  rule(
    "process.systems-named",
    "process",
    "warn",
    "Systems are listed",
    "Every system a step uses is listed under Systems.",
  ),
  rule(
    "process.decisions-have-branches",
    "process",
    "block",
    "Decisions say both ways",
    "A decision gives at least {minBranches} branches, each with what to do.",
    [num("minBranches", "Branches", 2, 4)],
    { minBranches: 2 },
  ),
  rule(
    "process.grounded",
    "process",
    "block",
    "Nothing invented",
    "A second model compares each step with what was said and shown; a step it cannot find in the Recording is a finding.",
  ),

  // Deck layout ------------------------------------------------------------
  rule(
    "layout.safe-area",
    "layout",
    "block",
    "Inside the margins",
    "Nothing sits closer than {margin} px to the slide edge.",
    [num("margin", "Margin", 16, 120, 4, "px")],
    { margin: 48 },
  ),
  rule(
    "layout.no-overlap",
    "layout",
    "block",
    "Nothing overlaps",
    "Text, screenshots and callouts keep at least {gap} px between them.",
    [num("gap", "Gap", 0, 48, 2, "px")],
    { gap: 12 },
  ),
  rule(
    "layout.text-fits",
    "layout",
    "block",
    "Text fits its box",
    "No text box holds more lines than its height allows.",
  ),
  rule(
    "layout.min-font-size",
    "layout",
    "block",
    "Readable from the back",
    "Body text is at least {body} pt and titles at least {title} pt.",
    [
      num("body", "Body", 10, 28, 1, "pt"),
      num("title", "Title", 18, 54, 1, "pt"),
    ],
    { body: 16, title: 28 },
  ),
  rule(
    "layout.aligned",
    "layout",
    "block",
    "Edges line up",
    "Elements on a slide share left edges: at most {maxEdges} distinct ones, within {tolerance} px.",
    [
      num("maxEdges", "Left edges", 1, 6),
      num("tolerance", "Tolerance", 0, 8, 1, "px"),
    ],
    { maxEdges: 3, tolerance: 1 },
  ),
  rule(
    "layout.title-position",
    "layout",
    "block",
    "Titles do not jump",
    "The title sits in the same place on every slide of the same kind.",
  ),
  rule(
    "layout.contrast",
    "layout",
    "block",
    "Enough contrast",
    "Text against its background has a contrast ratio of at least {ratio}.",
    [num("ratio", "Ratio", 3, 12, 0.5)],
    { ratio: 4.5 },
  ),

  // Deck content -----------------------------------------------------------
  rule(
    "content.max-bullets",
    "content",
    "block",
    "Few points per slide",
    "A slide has at most {max} bullets.",
    [num("max", "Bullets", 2, 8)],
    { max: 4 },
  ),
  rule(
    "content.bullet-length",
    "content",
    "block",
    "Short bullets",
    "A bullet has at most {maxWords} words.",
    [num("maxWords", "Words", 6, 30)],
    { maxWords: 14 },
  ),
  rule(
    "content.title-length",
    "content",
    "block",
    "Short titles",
    "A slide title has at most {maxChars} characters.",
    [num("maxChars", "Characters", 20, 90, 5)],
    { maxChars: 48 },
  ),
  rule(
    "content.every-step-covered",
    "content",
    "block",
    "No step left out",
    "Every step of the Process has a slide, in order.",
  ),
  rule(
    "content.opens-and-closes",
    "content",
    "block",
    "A beginning and an end",
    "The deck opens with a title slide and closes with a summary or open questions.",
  ),
  rule(
    "content.slide-count",
    "content",
    "warn",
    "Not too long",
    "The deck has at most {max} slides.",
    [num("max", "Slides", 6, 40)],
    { max: 24 },
  ),
  rule(
    "content.speaker-notes",
    "content",
    "warn",
    "Notes for the presenter",
    "Every slide has speaker notes.",
  ),

  // Deck motion ------------------------------------------------------------
  rule(
    "motion.transition-on-every-slide",
    "motion",
    "block",
    "Slides change smoothly",
    "Every slide has a transition, and the deck uses one style throughout.",
  ),
  rule(
    "motion.entrances",
    "motion",
    "block",
    "Points arrive one at a time",
    "Every content slide brings its points in with an entrance, in reading order.",
  ),
  rule(
    "motion.budget",
    "motion",
    "block",
    "Not a light show",
    "A slide has at most {max} animated elements.",
    [num("max", "Animations", 2, 12)],
    { max: 7 },
  ),
  rule(
    "motion.timing",
    "motion",
    "warn",
    "Quick, not abrupt",
    "Entrances take between {min} and {max} ms.",
    [
      num("min", "Shortest", 100, 600, 50, "ms"),
      num("max", "Longest", 300, 2000, 50, "ms"),
    ],
    { min: 250, max: 700 },
  ),

  // Review loop ------------------------------------------------------------
  rule(
    "loop.reviewer",
    "loop",
    "block",
    "A second model reviews the deck",
    "A reviewer model reads every slide against the Process. A major finding stops Approval.",
  ),
  rule(
    "loop.max-rounds",
    "loop",
    "block",
    "Rounds before giving up",
    "The deck gets up to {rounds} Rounds: a draft, then revisions. If the last still fails, it is held for a person.",
    [num("rounds", "Rounds", 1, 5)],
    { rounds: 3 },
  ),
  rule(
    "loop.auto-fit",
    "loop",
    "warn",
    "Fit by rule on the last round",
    "On the last round, slides that still break a layout or content rule are split or trimmed by rule instead of by the model.",
  ),
];

export const RULE_IDS = RULES.map((item) => item.id);

/** A Rule as it applies now: the default with an Owner's override on top. */
export type Rule = {
  id: string;
  group: RuleGroup;
  title: string;
  description: string;
  severity: Severity;
  enabled: boolean;
  params: Record<string, number>;
  /** True when it differs from the default. */
  edited: boolean;
};

export const ruleOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(["block", "warn"]).optional(),
  params: z.record(z.string(), z.number()).optional(),
});
export type RuleOverride = z.infer<typeof ruleOverrideSchema>;
export type RuleOverrides = Record<string, RuleOverride>;

/** Rules a person may not switch off: without them nothing is ever approved honestly. */
export const LOCKED_ON = ["loop.max-rounds"];

function clampParam(def: ParamDef, value: number): number {
  if (!Number.isFinite(value)) return def.min;
  const stepped = Math.round(value / def.step) * def.step;
  return Math.min(def.max, Math.max(def.min, Number(stepped.toFixed(4))));
}

/** Drops unknown Rules and Parameters and clamps the rest, so stored overrides are always safe to apply. */
export function cleanOverrides(input: unknown): RuleOverrides {
  const parsed = z.record(z.string(), ruleOverrideSchema).safeParse(input);
  if (!parsed.success) return {};
  const clean: RuleOverrides = {};
  for (const def of RULES) {
    const override = parsed.data[def.id];
    if (!override) continue;
    const next: RuleOverride = {};
    if (
      override.enabled !== undefined &&
      override.enabled !== def.enabled &&
      !(LOCKED_ON.includes(def.id) && !override.enabled)
    ) {
      next.enabled = override.enabled;
    }
    if (override.severity && override.severity !== def.severity) {
      next.severity = override.severity;
    }
    const params: Record<string, number> = {};
    for (const param of def.params) {
      const value = override.params?.[param.key];
      if (value === undefined) continue;
      const clamped = clampParam(param, value);
      if (clamped !== def.defaults[param.key]) params[param.key] = clamped;
    }
    // A range cannot be upside down: a raised minimum lifts the maximum with it.
    const keys = def.params.map((param) => param.key);
    if (keys.includes("min") && keys.includes("max")) {
      const min = params.min ?? def.defaults.min;
      const max = params.max ?? def.defaults.max;
      if (min > max) {
        const maxDef = def.params.find((param) => param.key === "max");
        const lifted = maxDef ? clampParam(maxDef, min) : min;
        if (lifted !== def.defaults.max) params.max = lifted;
        else delete params.max;
        if (lifted < min) params.min = lifted;
      }
    }
    if (Object.keys(params).length > 0) next.params = params;
    if (Object.keys(next).length > 0) clean[def.id] = next;
  }
  return clean;
}

export function resolveRules(overrides: RuleOverrides = {}): Rule[] {
  const clean = cleanOverrides(overrides);
  return RULES.map((def) => {
    const override = clean[def.id];
    return {
      id: def.id,
      group: def.group,
      title: def.title,
      description: def.description,
      severity: override?.severity ?? def.severity,
      enabled: override?.enabled ?? def.enabled,
      params: { ...def.defaults, ...override?.params },
      edited: Boolean(override),
    };
  });
}

export type RuleSet = Map<string, Rule>;
export function ruleSet(rules: Rule[]): RuleSet {
  return new Map(rules.map((item) => [item.id, item]));
}

/** A Rule's description with its Parameters filled in. */
export function describeRule(item: Rule): string {
  return item.description.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(item.params[key] ?? `{${key}}`),
  );
}

/** One Rule applied to one Process or Deck. */
export type CheckResult = {
  ruleId: string;
  severity: Severity;
  passed: boolean;
  /** What was found, in a sentence: "2 of 9 slides overflow". */
  summary: string;
  /** Where it failed: at most a handful, each naming the slide or step. */
  failures: CheckFailure[];
};

export type CheckFailure = {
  /** A slide's plan id (`p3`) or a step id (`s4`), when it is about one. */
  target: string | null;
  message: string;
};

/** A finding from a reviewer model, on the Process (grounding) or the Deck. */
export type ReviewFinding = {
  target: string | null;
  severity: "major" | "minor";
  issue: string;
  fix: string;
};

export const reviewSchema = z.object({
  findings: z.array(
    z.object({
      target: z
        .string()
        .nullable()
        .describe("The slide id (p3) or step id (s4) it is about, else null"),
      severity: z.enum(["major", "minor"]),
      issue: z.string(),
      fix: z.string().describe("The change to make, concretely"),
    }),
  ),
});

export function blocking(results: CheckResult[]): CheckResult[] {
  return results.filter((item) => !item.passed && item.severity === "block");
}
