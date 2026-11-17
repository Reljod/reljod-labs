/**
 * The shared contract of the Name Extraction demo (shown to visitors as
 * "Sieve"). Domain words are in ../GLOSSARY.md. Every other module of the
 * feature (corpus, sweep, the Analyst, the workflow, the UI, the MCP server)
 * builds on these types; change them here first.
 */
import { z } from "zod";

// Documents --------------------------------------------------------------------

/** A Document as the Analyst sees it: its text, one string per page. */
export type DocumentText = {
  id: string;
  title: string;
  /** pages[0] is page 1. */
  pages: string[];
};

/** Where a Document came from. Corpus Documents are generated from a seed, never stored. */
export type DocumentSource =
  | { kind: "corpus"; corpusId: string }
  | { kind: "upload"; uploadId: string };

export const SPLITS = ["train", "validation", "test"] as const;
export type Split = (typeof SPLITS)[number];

// Names --------------------------------------------------------------------------

export const ENTITY_TYPES = ["person", "organization"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** The part a Name plays in the Document, as far as the text says. */
export const ROLES = [
  "account_holder",
  "counterparty",
  "beneficial_owner",
  "director",
  "signatory",
  "employee",
  "witness",
  "official",
  "other",
] as const;
export type Role = (typeof ROLES)[number];

/** One place a Name appears: the page and the words exactly as printed. */
export type Mention = {
  page: number;
  /** The surface form, verbatim from the page text. */
  quote: string;
};

/** Who or what found a Name. Recall comes from the union; the Analyst decides. */
export const FINDERS = ["sweep", "reader", "code", "analyst"] as const;
export type Finder = (typeof FINDERS)[number];

/** One distinct party the Document names, with every alias and mention folded in. */
export type ExtractedName = {
  /** The fullest form, e.g. "Ana Lucía Ferreira-Vos". */
  canonical: string;
  type: EntityType;
  aliases: string[];
  roles: Role[];
  mentions: Mention[];
  /** 0..1. Low-confidence Names are kept, flagged, never dropped (recall first). */
  confidence: number;
  foundBy: Finder[];
  /** Why the Analyst kept it, or why it is in doubt. */
  note?: string;
};

// Rulebook --------------------------------------------------------------------------

/**
 * The editable rules of extraction. A Rulebook belongs to an Owner and is
 * versioned: every edit writes a new version, and every Run records the version
 * it ran under, so an audit can say exactly what the rules were.
 */
export const rulebookSchema = z.object({
  /** Entity types to extract. */
  entityTypes: z.array(z.enum(ENTITY_TYPES)).min(1),
  /** Keep a Name below this confidence as "in doubt" instead of dropping it. */
  reviewBelow: z.number().min(0).max(1),
  /** Drop a Name only below this. Recall first: default 0. */
  dropBelow: z.number().min(0).max(1),
  /** Fold aliases, initials, reordered and transliterated forms into one Name. */
  resolveAliases: z.boolean(),
  /** Extract names that only appear inside email addresses or handles. */
  includeHandles: z.boolean(),
  /** Extract officials acting in an official capacity (judges, notaries, registrars). */
  includeOfficials: z.boolean(),
  /** Never extract these (exact, case-insensitive), e.g. the bank's own name. */
  exclude: z.array(z.string().min(1).max(200)).max(200),
  /** Plain-language instructions the Analyst and its Readers must follow. */
  instructions: z.array(z.string().min(1).max(500)).max(30),
});
export type Rulebook = z.infer<typeof rulebookSchema>;

export const DEFAULT_RULEBOOK: Rulebook = {
  entityTypes: ["person", "organization"],
  reviewBelow: 0.6,
  dropBelow: 0,
  resolveAliases: true,
  includeHandles: true,
  includeOfficials: true,
  exclude: ["Meridia Central Bank", "Republic of Meridia"],
  instructions: [
    "A name split across a line or a page break is one name.",
    "A name in a table, a header, a signature block or a SWIFT field counts.",
    "Streets, vessels' ports, products and places named after people are not parties.",
    "When in doubt, keep the name and say why it is in doubt.",
  ],
};

// Models ------------------------------------------------------------------------------

/** Who calls a model: the one Analyst, or a Reader it spawns. */
export const PURPOSES = {
  analyst: {
    label: "Analyst",
    hint: "The one agent: plans, codes, spawns Readers, decides",
  },
  reader: {
    label: "Reader",
    hint: "A sub-agent over one page range; cheap and parallel",
  },
} as const;
export type Purpose = keyof typeof PURPOSES;

/** Models a visitor may pick, with USD list prices per million tokens for estimates. */
export const MODELS = {
  "anthropic/claude-sonnet-5.5": {
    label: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    cacheRead: 0.1,
    tier: null,
  },
  "openai/gpt-6.1-terra": {
    label: "GPT-6.1 Terra",
    input: 1,
    output: 5,
    cacheRead: 0.05,
    tier: { above: 272_000, input: 2, output: 7.5 },
  },
  "anthropic/claude-haiku-5.5": {
    label: "Claude Haiku 5.5",
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    tier: { above: 100_000, input: 0.5, output: 2.5 },
  },
  "openai/gpt-6-luna": {
    label: "GPT-6 Luna",
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    tier: { above: 272_000, input: 0.2, output: 0.75 },
  },
  "google/gemini-3.8-flash": {
    label: "Gemini 3.8 Flash",
    input: 0.75,
    output: 3.75,
    cacheRead: 0.075,
    tier: null,
  },
  "zai/glm-5.3-flash": {
    label: "GLM 5.3 Flash",
    input: 0.15,
    output: 0.5,
    cacheRead: 0.03,
    tier: null,
  },
} as const;
export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

export const modelChoiceSchema = z.object({
  analyst: z.enum(MODEL_IDS as [ModelId, ...ModelId[]]),
  reader: z.enum(MODEL_IDS as [ModelId, ...ModelId[]]),
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const DEFAULT_MODELS: ModelChoice = {
  analyst: "openai/gpt-6.1-terra",
  reader: "anthropic/claude-haiku-5.5",
};

/**
 * USD for a call from usage, when the gateway does not report what it charged.
 * Cached input is billed at the cache-read price; a call whose prompt is above
 * the model's tier is billed at the tier's prices for the whole call (the
 * conservative reading; docs/research/name-extraction.md).
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
) {
  const price = MODELS[model as ModelId];
  if (!price) return 0;
  const tier = price.tier && inputTokens > price.tier.above ? price.tier : null;
  const input = tier?.input ?? price.input;
  const output = tier?.output ?? price.output;
  const cached = Math.min(Math.max(cachedInputTokens, 0), inputTokens);
  return (
    ((inputTokens - cached) * input +
      cached * price.cacheRead +
      outputTokens * output) /
    1_000_000
  );
}

// The Analyst's toolkit ---------------------------------------------------------------

/**
 * The Analyst's tools. One agent, no fixed pipeline: it decides which to call
 * and in what order. The harness only checks the Done gate.
 */
export const TOOLS = {
  outline: {
    label: "outline",
    hint: "Page count, characters per page, headings and the Sweep's counts per page",
  },
  read_pages: { label: "read_pages", hint: "The text of a few pages (capped)" },
  grep: {
    label: "grep",
    hint: "Regex over every page, returns hits with page numbers",
  },
  run_code: {
    label: "run_code",
    hint: "Runs JavaScript it writes in a Vercel Sandbox with the pages on disk, no network",
  },
  spawn_readers: {
    label: "spawn_readers",
    hint: "Fans out Readers (sub-agents) over page ranges in parallel",
  },
  load_skill: {
    label: "load_skill",
    hint: "Loads a Skill's playbook into context",
  },
  record_names: {
    label: "record_names",
    hint: "Adds or merges Names in the Register",
  },
  finish: {
    label: "finish",
    hint: "Ends the Run; refused until the Done gate passes",
  },
} as const;
export type ToolId = keyof typeof TOOLS;

/** Skills: playbooks the Analyst loads on demand (progressive disclosure). */
export const SKILL_IDS = [
  "long-document-triage",
  "aml-name-patterns",
  "alias-resolution",
  "recall-audit",
  "sandbox-coding",
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

// The Done gate ------------------------------------------------------------------------

/**
 * What the harness checks before `finish` may end a Run. The Analyst chooses
 * how to work; the gate makes sure it did not skip pages or candidates.
 */
export type DoneGate = {
  pagesTotal: number;
  /** Pages a Reader or read_pages covered. */
  pagesRead: number;
  /** Sweep candidates neither recorded as a Name nor dismissed with a reason. */
  candidatesOpen: number;
  passed: boolean;
};

/** exitCode of a `code` event written before the code ran. */
export const CODE_PENDING = -1;

// Run events (the audit trail) ----------------------------------------------------------

/**
 * Everything a Run streams and stores. The stored list is the audit trail:
 * append-only, ordered by `seq`, never edited.
 */
export type RunEvent = { at: number } & (
  | {
      type: "start";
      document: { id: string; title: string; pages: number };
      source: DocumentSource;
      models: ModelChoice;
      rulebookVersion: number;
    }
  | { type: "thought"; text: string }
  | {
      type: "tool";
      callId: string;
      tool: ToolId;
      /** Short form of the input, for the timeline; full input in the audit row. */
      summary: string;
      input: unknown;
      state: "start" | "done" | "error";
      output?: string;
      ms?: number;
    }
  | { type: "skill"; skill: SkillId }
  | {
      type: "reader";
      readerId: string;
      from: number;
      to: number;
      state: "start" | "done" | "error";
      names?: number;
      ms?: number;
    }
  | {
      /**
       * Written twice per run_code call: before the code runs, with exitCode
       * CODE_PENDING, then with the result (ADR 0019). Keep the last per callId.
       */
      type: "code";
      callId: string;
      code: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      ms: number;
    }
  | { type: "names"; names: ExtractedName[] }
  | { type: "gate"; gate: DoneGate }
  | {
      type: "cost";
      purpose: Purpose;
      model: string;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      ms: number;
    }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | {
      type: "end";
      status: "completed" | "failed" | "stopped";
      error?: string;
      /** Filled when the Document is from the corpus and has an answer key. */
      score?: Score;
      /**
       * Whether the Done gate had passed when the Run ended. Optional because
       * ends written before this field, and ends written outside the workflow
       * (a stop, a failed start, the stream's fallback), do not carry it.
       */
      gatePassed?: boolean;
      /**
       * Set when the harness wound a "completed" Run up before the Done gate
       * passed: at the turn cap, at the spend cap, or after the Analyst stopped
       * calling tools.
       */
      stoppedBy?: StopReason;
    }
);

/** Why the harness wound a Run up before `finish` passed the Done gate. */
export const STOP_REASONS = ["turns", "cost", "idle"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type RunEventInput = DistributiveOmit<RunEvent, "at">;

// Scoring -------------------------------------------------------------------------------

/** How a Run did against a corpus Document's answer key. Recall is the headline. */
export type Score = {
  expected: number;
  found: number;
  truePositives: number;
  recall: number;
  precision: number;
  /** Canonical forms of expected Names that were missed. */
  missed: string[];
};

// What the server hands the page --------------------------------------------------------

/** A Corpus Document as a card in the picker. */
export type CorpusCard = {
  id: string;
  title: string;
  /** e.g. "Wire transfer ledger", "Court judgment", "KYC file". */
  genre: string;
  pages: number;
  split: Split;
  description: string;
  /** Names in the Answer key. */
  expectedNames: number;
};

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type RunSummary = {
  id: string;
  title: string;
  pages: number;
  source: DocumentSource;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  models: ModelChoice;
  rulebookVersion: number;
  costUsd: number;
  names: number;
  score: Score | null;
};

export type RunDetail = Omit<RunSummary, "names"> & {
  /** The Audit trail so far, in order. */
  events: (RunEvent & { seq: number })[];
  names: ExtractedName[];
};

export type RulebookVersion = {
  version: number;
  rulebook: Rulebook;
  createdAt: string;
  /** null for the built-in default (version 0). */
  note: string | null;
};
