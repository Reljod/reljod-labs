/**
 * A Walk: what the Walker (the model) reported while watching the footage,
 * and what code made of it. Pure: the route, the recorded replays, the
 * Standard tab and the tests all call these same functions.
 *
 *   Sighting  what the model says it saw: a Rule it cites, a second, a box.
 *   Finding   a Sighting that passed every check (`checkSighting`).
 *   Noticed   a Sighting that cites no Rule: shown, never scored.
 *
 * The model never scores. `scoreWalk` reads only Findings and the Standard.
 */
import { z } from "zod";
import {
  RULES,
  type Rule,
  SEVERITY_WEIGHT,
  type Severity,
  type Standard,
} from "./rules";

/** A box as fractions of the frame: top, left, bottom, right in 0..1. */
export type Box = readonly [
  top: number,
  left: number,
  bottom: number,
  right: number,
];

/** One line the Walker writes. Its boxes are 0..1000, Gemini's native grid. */
export const walkerLineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("zone"),
    at: z.number(),
    zone: z.string().min(1).max(60),
  }),
  z.object({
    type: z.literal("sighting"),
    at: z.number(),
    rule: z.string().max(40).nullable(),
    zone: z.string().max(60).default(""),
    box: z.array(z.number()).length(4),
    saw: z.string().min(1).max(400),
    confidence: z.number().min(0).max(1).default(0.7),
  }),
]);
export type WalkerLine = z.infer<typeof walkerLineSchema>;
export type Sighting = Extract<WalkerLine, { type: "sighting" }>;

export type Finding = {
  id: string;
  rule: string;
  at: number;
  zone: string;
  box: Box;
  saw: string;
  confidence: number;
  /** Later seconds the same problem was seen again, folded in. */
  alsoAt: number[];
};

export type Noticed = {
  id: string;
  at: number;
  zone: string;
  box: Box | null;
  saw: string;
};

export type RefusalReason =
  | "no-such-rule"
  | "outside-the-walk"
  | "no-box"
  | "unsure";

export const REFUSAL_WORDS: Record<RefusalReason, string> = {
  "no-such-rule": "cites a Rule the Standard does not have",
  "outside-the-walk": "points at a second that is not in the footage",
  "no-box": "has no usable box around what it saw",
  unsure: "the Walker was not sure enough",
};

export type Verdict =
  | { kind: "finding"; finding: Finding }
  | { kind: "merged"; into: string; at: number }
  | { kind: "noticed"; noticed: Noticed }
  | { kind: "refused"; reason: RefusalReason; sighting: Sighting };

/** Parameters of the checks. Data, shown on the Standard tab. */
export const CHECKS = {
  /** A Sighting below this confidence is refused. */
  confidenceFloor: 0.45,
  /** The smallest box, as a share of the frame. */
  minBoxArea: 0.0015,
  /** Two Sightings of one Rule this close in time and overlapping are one Finding. */
  mergeSeconds: 4,
  mergeOverlap: 0.2,
  /** Same Rule and same Zone within this many seconds is the same problem. */
  sameZoneSeconds: 8,
} as const;

/** Clamps a 0..1000 box into a 0..1 Box, or null when it is not a box. */
export function toBox(raw: readonly number[]): Box | null {
  if (raw.length !== 4 || raw.some((v) => !Number.isFinite(v))) return null;
  const [a, b, c, d] = raw.map((v) => Math.min(1, Math.max(0, v / 1000))) as [
    number,
    number,
    number,
    number,
  ];
  const box: Box = [
    Math.min(a, c),
    Math.min(b, d),
    Math.max(a, c),
    Math.max(b, d),
  ];
  return boxArea(box) >= CHECKS.minBoxArea ? box : null;
}

export function boxArea(box: Box): number {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

export function iou(a: Box, b: Box): number {
  const top = Math.max(a[0], b[0]);
  const left = Math.max(a[1], b[1]);
  const bottom = Math.min(a[2], b[2]);
  const right = Math.min(a[3], b[3]);
  const inter = Math.max(0, bottom - top) * Math.max(0, right - left);
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

/**
 * Decides what one Sighting is. `known` are the Findings so far, in order;
 * `rules` the Rules the Walker was asked about; `seconds` the footage's length.
 */
export function checkSighting(
  sighting: Sighting,
  ctx: {
    rules: readonly Rule[];
    seconds: number;
    known: readonly Finding[];
    nextId: () => string;
  },
): Verdict {
  if (!(sighting.at >= 0 && sighting.at <= ctx.seconds + 0.5))
    return { kind: "refused", reason: "outside-the-walk", sighting };
  const box = toBox(sighting.box);
  if (sighting.rule === null || sighting.rule === "")
    return {
      kind: "noticed",
      noticed: {
        id: ctx.nextId(),
        at: round(sighting.at),
        zone: sighting.zone,
        box,
        saw: sighting.saw,
      },
    };
  if (!ctx.rules.some((rule) => rule.id === sighting.rule))
    return { kind: "refused", reason: "no-such-rule", sighting };
  if (!box) return { kind: "refused", reason: "no-box", sighting };
  if (sighting.confidence < CHECKS.confidenceFloor)
    return { kind: "refused", reason: "unsure", sighting };
  const same = ctx.known.find(
    (f) =>
      f.rule === sighting.rule &&
      ((Math.abs(lastSeen(f) - sighting.at) <= CHECKS.mergeSeconds &&
        iou(f.box, box) >= CHECKS.mergeOverlap) ||
        (norm(f.zone) !== "" &&
          norm(f.zone) === norm(sighting.zone) &&
          Math.abs(lastSeen(f) - sighting.at) <= CHECKS.sameZoneSeconds)),
  );
  if (same) return { kind: "merged", into: same.id, at: round(sighting.at) };
  return {
    kind: "finding",
    finding: {
      id: ctx.nextId(),
      rule: sighting.rule,
      at: round(sighting.at),
      zone: sighting.zone,
      box,
      saw: sighting.saw,
      confidence: sighting.confidence,
      alsoAt: [],
    },
  };
}

function lastSeen(f: Finding): number {
  return f.alsoAt.length ? (f.alsoAt[f.alsoAt.length - 1] as number) : f.at;
}

export function round(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- the Score and the Fix list ----------

export type Band = {
  min: number;
  label: string;
  tone: "pass" | "fix" | "stop";
};
export const BANDS: readonly Band[] = [
  { min: 85, label: "Fit to open", tone: "pass" },
  { min: 60, label: "Fix today", tone: "fix" },
  { min: 0, label: "Stop and fix", tone: "stop" },
];

export type Scored = {
  score: number;
  band: Band;
  counted: {
    finding: Finding;
    rule: Rule;
    severity: Severity;
    points: number;
  }[];
  /** Findings whose Rule the visitor switched off. */
  ignored: Finding[];
};

/** The Score: 100 less each counted Finding's weight. Only the Standard decides. */
export function scoreWalk(
  findings: readonly Finding[],
  standard: Standard,
): Scored {
  const counted: Scored["counted"] = [];
  const ignored: Finding[] = [];
  for (const finding of findings) {
    const rule = RULES.find((r) => r.id === finding.rule);
    const setting = standard[finding.rule];
    if (!rule || !setting?.on) {
      ignored.push(finding);
      continue;
    }
    counted.push({
      finding,
      rule,
      severity: setting.severity,
      points: SEVERITY_WEIGHT[setting.severity],
    });
  }
  const order: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };
  counted.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      a.rule.fixWithinHours - b.rule.fixWithinHours ||
      a.finding.at - b.finding.at,
  );
  const score = Math.max(
    0,
    100 - counted.reduce((sum, c) => sum + c.points, 0),
  );
  const band =
    BANDS.find((b) => score >= b.min) ?? (BANDS[BANDS.length - 1] as Band);
  return { score, band, counted, ignored };
}

/** "Now", "within 1 hour", "by 07:42" when the walk's clock is known. */
export function dueWords(rule: Rule, clock?: string, at = 0): string {
  if (rule.fixWithinHours === 0) return "Now";
  if (!clock) return `Within ${rule.fixWithinHours} h`;
  const due = new Date(
    new Date(`${clock}Z`).getTime() + (at + rule.fixWithinHours * 3600) * 1000,
  );
  const hh = String(due.getUTCHours()).padStart(2, "0");
  const mm = String(due.getUTCMinutes()).padStart(2, "0");
  return rule.fixWithinHours >= 24 ? "By tomorrow" : `By ${hh}:${mm}`;
}

// ---------- measured against the answer key ----------

export type KeyItem = {
  id: string;
  rule: string;
  decoy: boolean;
  note: string;
  spans: [number, number][];
  best: { at: number; box: [number, number, number, number] } | null;
};
export type AnswerKey = { seconds: number; fps: number; items: KeyItem[] };

export type Measured = {
  found: { item: KeyItem; finding: Finding }[];
  missed: KeyItem[];
  /** Decoys the Walker flagged anyway. */
  fooled: { item: KeyItem; finding: Finding }[];
  /** Decoys it rightly left alone. */
  resisted: KeyItem[];
  /** Findings that match nothing planted. */
  extra: Finding[];
};

/** Slack around a planted problem's time in view, for the model's timestamps. */
export const KEY_SLACK_SECONDS = 1.5;

function inSpans(item: KeyItem, f: Finding): boolean {
  const times = [f.at, ...f.alsoAt];
  return item.spans.some(([a, b]) =>
    times.some((t) => t >= a - KEY_SLACK_SECONDS && t <= b + KEY_SLACK_SECONDS),
  );
}

/**
 * How a Walk of a Sample did against the answer key the render wrote. A
 * planted problem is found by a Finding of its Rule while it was in view; a
 * decoy fools the Walker when a Finding of its Rule lands only on the decoy.
 */
export function measureWalk(
  findings: readonly Finding[],
  key: AnswerKey,
): Measured {
  const used = new Set<string>();
  const found: Measured["found"] = [];
  const missed: KeyItem[] = [];
  for (const item of key.items.filter((i) => !i.decoy)) {
    const hit = findings.find(
      (f) => !used.has(f.id) && f.rule === item.rule && inSpans(item, f),
    );
    if (hit) {
      used.add(hit.id);
      found.push({ item, finding: hit });
    } else missed.push(item);
  }
  const fooled: Measured["fooled"] = [];
  const resisted: KeyItem[] = [];
  for (const item of key.items.filter((i) => i.decoy)) {
    const hit = findings.find(
      (f) => !used.has(f.id) && f.rule === item.rule && inSpans(item, f),
    );
    if (hit) {
      used.add(hit.id);
      fooled.push({ item, finding: hit });
    } else resisted.push(item);
  }
  return {
    found,
    missed,
    fooled,
    resisted,
    extra: findings.filter((f) => !used.has(f.id)),
  };
}

/**
 * Parses one line the Walker wrote. Anything that is not a Walker line is
 * null: the model's words are data, and a malformed line is simply not a
 * Sighting.
 */
export function parseLine(raw: string): WalkerLine | null {
  const text = raw.trim().replace(/,$/, "");
  if (!text.startsWith("{")) return null;
  try {
    const parsed = walkerLineSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
