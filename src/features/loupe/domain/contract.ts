/**
 * The shared contract of Loupe. Domain words are in ../GLOSSARY.md. Every
 * other module (the Toolkit, the Sweep, the Examiner, the workflow, the MCP
 * server, the UI) builds on these types; change them here first.
 *
 * The Python Toolkit (../toolkit/loupe) writes Measurements in the shape of
 * `RawMeasurement`; `server/mcp-token.test.ts` keeps the two lists of Metrics
 * and Checks equal.
 */
import { z } from "zod";

// Documents ----------------------------------------------------------------------

export const DOCUMENT_KINDS = [
  "payslip",
  "bank_statement",
  "utility_bill",
  "invoice",
  "id_card",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const KIND_LABELS: Record<DocumentKind, string> = {
  payslip: "Payslip",
  bank_statement: "Bank statement",
  utility_bill: "Utility bill",
  invoice: "Invoice",
  id_card: "Identity card",
  other: "Other document",
};

export const FORMATS = ["pdf", "image"] as const;
export type DocumentFormat = (typeof FORMATS)[number];

export const SPLITS = ["train", "validation", "test"] as const;
export type Split = (typeof SPLITS)[number];

/** Where a Document came from. A Forgery is an Upload that carries its Edits. */
export type DocumentSource =
  | { kind: "sample"; sampleId: string }
  | { kind: "upload"; uploadId: string };

/**
 * A region of a page: [x0, y0, x1, y1], each 0..1 of the page's width and
 * height, origin top-left. Every box in Loupe uses this form, so a box means
 * the same place on the page image whatever its pixel size.
 */
export type Box = [number, number, number, number];

export const boxSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .refine(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0, {
    message: "A box is [x0, y0, x1, y1] with x1 > x0 and y1 > y0, each 0..1.",
  });

/** One page as shown: the rendered image and its pixel size. */
export type PageInfo = {
  /** 1-based. */
  page: number;
  width: number;
  height: number;
  /** A URL the browser can load: a static Sample image, or the Owner's asset route. */
  image: string;
};

// Metrics -----------------------------------------------------------------------

/**
 * What code can measure. Fixed: a Rule reads exactly one Metric, and a
 * Measurement under an unknown Metric is refused. `unit` is how a value is
 * printed; `floor` is the value of an untouched Document.
 */
export const METRICS = {
  // PDF structure
  "pdf.incremental_updates": {
    label: "Saves after the first",
    unit: "saves",
    group: "structure",
    plain:
      "A PDF can be changed by appending a new section to the file. Each one is a later save that altered the content.",
  },
  "pdf.editor_producer": {
    label: "Written by an editing tool",
    unit: "match",
    group: "structure",
    plain:
      "The file says which software wrote it. 1 when that is a PDF or image editor rather than the issuer's own system.",
  },
  "pdf.modified_gap_hours": {
    label: "Modified after it was created",
    unit: "hours",
    group: "structure",
    plain:
      "Hours between the file's creation date and its last modification date.",
  },
  "pdf.covered_text": {
    label: "Text hidden under a patch",
    unit: "runs",
    group: "structure",
    plain:
      "Text still in the file but painted over by an opaque shape, with other text drawn on top: the classic white-out edit.",
  },
  "pdf.text_over_image": {
    label: "Text drawn over a scan",
    unit: "runs",
    group: "structure",
    plain:
      "Live text placed on top of a full-page image, where a scan should have none.",
  },
  "pdf.annotations": {
    label: "Annotations over content",
    unit: "annotations",
    group: "structure",
    plain:
      "Free-text, stamp or redaction annotations sitting on top of the printed content.",
  },
  // Glyphs and fonts
  "glyph.font_outlier": {
    label: "Font unlike its neighbours",
    unit: "score",
    group: "type",
    plain:
      "How out of place a run's font is among the runs it sits with (same column, same row), 0 to 1.",
  },
  "glyph.size_delta_pt": {
    label: "Type size off",
    unit: "pt",
    group: "type",
    plain:
      "How far a run's type size is from the runs it sits with, in points.",
  },
  "glyph.baseline_offset_pt": {
    label: "Baseline off",
    unit: "pt",
    group: "type",
    plain:
      "How far a run sits above or below the baseline of its own line, in points.",
  },
  "glyph.spacing_outlier": {
    label: "Letter spacing off",
    unit: "z",
    group: "type",
    plain:
      "How unusual the spacing between a run's characters is for its font, in standard deviations.",
  },
  "glyph.color_delta": {
    label: "Ink colour off",
    unit: "ΔRGB",
    group: "type",
    plain:
      "Distance between a run's ink colour and the colour of the runs it sits with.",
  },
  // Pixels
  "image.ela_ratio": {
    label: "Error level against the page",
    unit: "×",
    group: "pixels",
    plain:
      "Re-save the image and see how much each block changes. A pasted or re-saved region changes by a different amount than the rest; this is that region's level over the page's.",
  },
  "image.noise_ratio": {
    label: "Noise against the page",
    unit: "×",
    group: "pixels",
    plain:
      "Sensor and paper noise is even across a real scan. This is how many times quieter or louder a region is than the page.",
  },
  "image.jpeg_ghost": {
    label: "Second compression history",
    unit: "score",
    group: "pixels",
    plain:
      "A region that was a JPEG at a different quality before it was pasted keeps a ghost of that quality, 0 to 1.",
  },
  "image.copy_move": {
    label: "Duplicated region",
    unit: "% of page",
    group: "pixels",
    plain:
      "Area of the page that is a pixel-level copy of another area, as a share of the page.",
  },
  "image.edge_halo": {
    label: "Halo around the text",
    unit: "×",
    group: "pixels",
    plain:
      "Pasted text brings its own edges. This is the strength of the halo around a region's characters over the page's.",
  },
  // Content
  "arith.sum_mismatch": {
    label: "Lines do not add up",
    unit: "M$",
    group: "content",
    plain:
      "Difference between a printed total and the sum of the lines it totals.",
  },
  "arith.balance_break": {
    label: "Running balance breaks",
    unit: "M$",
    group: "content",
    plain:
      "Difference between a printed balance and the balance before it plus or minus the transaction.",
  },
  "arith.rate_mismatch": {
    label: "Tax does not match its rate",
    unit: "M$",
    group: "content",
    plain:
      "Difference between a printed tax or deduction and the stated rate applied to its base.",
  },
  "format.date_anomaly": {
    label: "A date that cannot be",
    unit: "dates",
    group: "content",
    plain:
      "Dates that contradict the document: outside its own period, out of order, or not a real day.",
  },
  "format.style_break": {
    label: "A field formatted unlike the rest",
    unit: "fields",
    group: "content",
    plain:
      "Figures or dates written in a different format from the same kind of field elsewhere in the document.",
  },
  "id.checksum_invalid": {
    label: "A number whose check digits fail",
    unit: "numbers",
    group: "content",
    plain:
      "Account, document and identity numbers carry check digits. This counts the ones whose check fails.",
  },
} as const;
export type MetricId = keyof typeof METRICS;
export const METRIC_IDS = Object.keys(METRICS) as MetricId[];
export const metricIdSchema = z.enum(METRIC_IDS as [MetricId, ...MetricId[]]);

export const METRIC_GROUPS = {
  structure: "File structure",
  type: "Type and glyphs",
  pixels: "Pixels",
  content: "What it says",
} as const;
export type MetricGroup = keyof typeof METRIC_GROUPS;

// Checks -------------------------------------------------------------------------

/**
 * The Toolkit's named Checks. The Sweep runs every one that fits the
 * Document's format; `run_check` runs one, on a page or a region.
 */
export const CHECKS = {
  pdf_structure: {
    label: "PDF structure",
    formats: ["pdf"],
    hint: "Incremental updates, producer and dates, annotations, text over images",
    metrics: [
      "pdf.incremental_updates",
      "pdf.editor_producer",
      "pdf.modified_gap_hours",
      "pdf.text_over_image",
      "pdf.annotations",
    ],
  },
  pdf_overpaint: {
    label: "Hidden text",
    formats: ["pdf"],
    hint: "Text painted over by an opaque shape with other text on top",
    metrics: ["pdf.covered_text"],
  },
  glyphs: {
    label: "Font and glyph metrics",
    formats: ["pdf"],
    hint: "Font, size, baseline, spacing and ink colour of every text run against its neighbours",
    metrics: [
      "glyph.font_outlier",
      "glyph.size_delta_pt",
      "glyph.baseline_offset_pt",
      "glyph.spacing_outlier",
      "glyph.color_delta",
    ],
  },
  arithmetic: {
    label: "Arithmetic",
    formats: ["pdf"],
    hint: "Lines against totals, running balances, tax against its rate, from the text layer",
    metrics: [
      "arith.sum_mismatch",
      "arith.balance_break",
      "arith.rate_mismatch",
    ],
  },
  dates_formats: {
    label: "Dates and formats",
    formats: ["pdf"],
    hint: "Dates against the document's own period, and fields formatted unlike the rest",
    metrics: ["format.date_anomaly", "format.style_break"],
  },
  checksums: {
    label: "Check digits",
    formats: ["pdf"],
    hint: "Meridian IBANs, account, tax and document numbers",
    metrics: ["id.checksum_invalid"],
  },
  ela: {
    label: "Error-level analysis",
    formats: ["image"],
    hint: "Re-saves the image and maps where the error level departs from the page",
    metrics: ["image.ela_ratio"],
  },
  noise: {
    label: "Noise consistency",
    formats: ["image"],
    hint: "Maps local noise against the page's",
    metrics: ["image.noise_ratio"],
  },
  jpeg_ghost: {
    label: "JPEG ghosts",
    formats: ["image"],
    hint: "Finds regions that carry a different compression history",
    metrics: ["image.jpeg_ghost"],
  },
  copy_move: {
    label: "Copy-move",
    formats: ["image"],
    hint: "Finds areas that are copies of other areas of the same page",
    metrics: ["image.copy_move"],
  },
  edge_halo: {
    label: "Edge halos",
    formats: ["image"],
    hint: "Measures halos around text against the page's",
    metrics: ["image.edge_halo"],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    formats: readonly DocumentFormat[];
    hint: string;
    metrics: readonly MetricId[];
  }
>;
export type CheckId = keyof typeof CHECKS;
export const CHECK_IDS = Object.keys(CHECKS) as CheckId[];
export const checkIdSchema = z.enum(CHECK_IDS as [CheckId, ...CheckId[]]);

/** The Checks that fit a format. A scanned PDF page is examined as an image too (the Toolkit decides). */
export function checksFor(format: DocumentFormat): CheckId[] {
  return CHECK_IDS.filter((id) =>
    (CHECKS[id].formats as readonly DocumentFormat[]).includes(format),
  );
}

// Measurements ------------------------------------------------------------------

/** How an Evidence layer is drawn. */
export const LAYER_KINDS = ["heatmap", "marks", "compare"] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

/** Who produced a Measurement: the Sweep, the Examiner's tools, or an outside MCP client's `run_check`. */
export const FINDERS = ["sweep", "examiner", "client"] as const;
export type Finder = (typeof FINDERS)[number];

/**
 * A Measurement as the Toolkit writes it (measurements.json, and each line of
 * reports.jsonl). `layer` is a file name beside it. Parsed, never trusted:
 * the code that wrote it may be the Examiner's.
 */
export const rawMeasurementSchema = z.object({
  metric: metricIdSchema,
  value: z.number().finite(),
  /** 1-based; 0 for the whole Document. */
  page: z.number().int().min(0).max(200),
  box: boxSchema.nullable().optional(),
  /** What was measured, with the numbers, in one sentence. */
  detail: z.string().min(1).max(400),
  /** The numbers behind `value`, for display: { printed: 4810.5, computed: 4100.5 }. */
  facts: z
    .record(
      z.string().max(40),
      z.union([z.number().finite(), z.string().max(200)]),
    )
    .optional(),
  /** File name of an Evidence layer written beside it (PNG). */
  layer: z
    .string()
    .max(120)
    .regex(/^[\w.-]+\.png$/)
    .optional(),
  layerKind: z.enum(LAYER_KINDS).optional(),
  check: checkIdSchema.optional(),
});
export type RawMeasurement = z.infer<typeof rawMeasurementSchema>;

/** A Measurement on an Examination: what the Toolkit wrote, plus who and which run produced it. */
export type Measurement = {
  /** Unique in the Examination: "s1" from the Sweep, "m7" from the Examiner or a client. */
  id: string;
  metric: MetricId;
  value: number;
  page: number;
  box: Box | null;
  detail: string;
  facts: Record<string, number | string>;
  /** Asset key of the Evidence layer, if code drew one. */
  layer: string | null;
  layerKind: LayerKind | null;
  finder: Finder;
  /** The named Check, or null when the Examiner's own code reported it. */
  check: CheckId | null;
  /** The code run that produced it (its `callId` on the Trail). */
  runId: string;
};

// Hypotheses -------------------------------------------------------------------

export type Hypothesis = {
  /** "h1", "h2"… */
  id: string;
  page: number;
  box: Box | null;
  /** What the Examiner saw, in its words. */
  claim: string;
  status: "open" | "supported" | "refuted";
  /** The Measurements that tested it. */
  measurementIds: string[];
  /** Why it was settled the way it was. */
  explanation: string | null;
  /** The Examiner's own confidence, 0..1. Shown, never used by the Verdict. */
  confidence: number | null;
};

/** The Examiner's review of a Sweep Finding. Shown to the reviewer; never changes the Verdict. */
export type Review = {
  stance: "agree" | "doubt";
  note: string;
};

// Findings and the Verdict -------------------------------------------------------

export const WEIGHTS = ["decisive", "supporting", "context"] as const;
export type Weight = (typeof WEIGHTS)[number];

export const WEIGHT_LABELS: Record<Weight, string> = {
  decisive: "Decisive",
  supporting: "Supporting",
  context: "Context",
};

/** A Measurement that trips a Rule. Built only by `evaluate` (domain/evaluate.ts). */
export type Finding = {
  /** The id of its strongest Measurement. */
  id: string;
  ruleId: MetricId;
  metric: MetricId;
  page: number;
  box: Box | null;
  value: number;
  threshold: number;
  /** How far past the threshold, as value / threshold (1 = at it). */
  margin: number;
  weight: Weight;
  /** 0..1, from the margin alone: code's confidence, not the model's. */
  confidence: number;
  detail: string;
  facts: Record<string, number | string>;
  layer: string | null;
  layerKind: LayerKind | null;
  /** Everyone whose Measurement supports it. */
  foundBy: Finder[];
  /** Every Measurement folded into it. */
  measurementIds: string[];
  check: CheckId | null;
  runId: string;
  /** The Hypothesis it supports, if the Examiner raised one. */
  hypothesisId: string | null;
  /** The Examiner's words about it: the Hypothesis's explanation, or its review of a Sweep Finding. */
  note: string | null;
  review: Review | null;
};

export const VERDICTS = ["genuine", "suspicious", "tampered"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  genuine: "Genuine",
  suspicious: "Suspicious",
  tampered: "Tampered",
};

export type VerdictResult = {
  verdict: Verdict;
  /** Why, as the Rulebook reads: one line per reason. */
  reasons: string[];
  decisive: number;
  supporting: number;
  context: number;
};

// The Examiner's toolkit -------------------------------------------------------------

/**
 * The Examiner's tools, each an MCP tool on /api/loupe/mcp. One agent, no
 * fixed pipeline: it decides which to call and in what order. The harness
 * owns the caps and the Done gate.
 */
export const TOOLS = {
  look: {
    label: "look",
    hint: "Sees a page, or a region of it zoomed in",
  },
  run_check: {
    label: "run_check",
    hint: "Runs one named Check from the Toolkit on a page or a region",
  },
  run_code: {
    label: "run_code",
    hint: "Runs Python it writes in the Sandbox, with the Document and the Toolkit on disk, no network",
  },
  load_skill: {
    label: "load_skill",
    hint: "Loads a Skill's playbook into context",
  },
  hypothesize: {
    label: "hypothesize",
    hint: "Records what it suspects and where, before testing it",
  },
  conclude: {
    label: "conclude",
    hint: "Settles a Hypothesis with the Measurements that tested it",
  },
  review_finding: {
    label: "review_finding",
    hint: "Says whether it agrees with a Sweep Finding, and why",
  },
  finish: {
    label: "finish",
    hint: "Ends the Examination; refused until the Done gate passes",
  },
} as const;
export type ToolId = keyof typeof TOOLS;
export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

export const SKILL_IDS = [
  "pdf-structure-forensics",
  "image-splicing",
  "statement-arithmetic",
  "font-forensics",
  "writing-a-finding",
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

// The Done gate ---------------------------------------------------------------------

export type DoneGate = {
  pagesTotal: number;
  /** Pages the Examiner looked at. */
  pagesLooked: number;
  /** Sweep Findings the Examiner has not reviewed. */
  findingsOpen: number;
  /** Hypotheses neither supported nor refuted. */
  hypothesesOpen: number;
  passed: boolean;
};

// Models --------------------------------------------------------------------------------

/** Vision models a visitor may pick for the Examiner, with USD list prices per million tokens. */
export const MODELS = {
  "anthropic/claude-sonnet-5.5": {
    label: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    cacheRead: 0.1,
  },
  "openai/gpt-6.1-terra": {
    label: "GPT-6.1 Terra",
    input: 1,
    output: 5,
    cacheRead: 0.05,
  },
  "google/gemini-3.8-flash": {
    label: "Gemini 3.8 Flash",
    input: 0.75,
    output: 3.75,
    cacheRead: 0.075,
  },
} as const;
export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];
export const modelIdSchema = z.enum(MODEL_IDS as [ModelId, ...ModelId[]]);
export const DEFAULT_MODEL: ModelId = "anthropic/claude-sonnet-5.5";

/** USD for a call from usage, when the gateway does not report what it charged. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
) {
  const price = MODELS[model as ModelId];
  if (!price) return 0;
  const cached = Math.min(Math.max(cachedInputTokens, 0), inputTokens);
  return (
    ((inputTokens - cached) * price.input +
      cached * price.cacheRead +
      outputTokens * price.output) /
    1_000_000
  );
}

// The Trail --------------------------------------------------------------------------------

/**
 * Who examines after the Sweep: the in-app Examiner (a model), nobody (the
 * Sweep alone, no model call), or an outside MCP client that drives the
 * Examiner's tools itself.
 */
export const DRIVERS = {
  examiner: "Examiner",
  sweep: "Sweep only",
  client: "Your own client",
} as const;
export type Driver = keyof typeof DRIVERS;

/** exitCode of a `code` event written before the code ran. */
export const CODE_PENDING = -1;

export const STOP_REASONS = ["turns", "cost", "idle"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export type ExaminationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

/**
 * Everything an Examination streams and stores. The stored list is the
 * Trail: append-only, ordered by `seq`, never edited.
 */
export type TrailEvent = { at: number } & (
  | {
      type: "start";
      document: {
        title: string;
        kind: DocumentKind;
        format: DocumentFormat;
      };
      source: DocumentSource;
      model: string;
      rulebookVersion: number;
      driver: Driver;
    }
  | { type: "pages"; pages: PageInfo[] }
  | {
      type: "sweep";
      state: "start" | "done" | "error";
      /** `recorded` when the Sweep's Measurements were taken when the Corpus was rendered. */
      mode: "live" | "recorded";
      checks: CheckId[];
      measurements?: number;
      ms?: number;
      error?: string;
    }
  | { type: "thought"; text: string }
  | {
      type: "tool";
      callId: string;
      tool: ToolId;
      /** Short form of the input, for the timeline. */
      summary: string;
      input: unknown;
      state: "start" | "done" | "error";
      output?: string;
      ms?: number;
    }
  | {
      /** Where the Examiner is looking, so the page can show it. */
      type: "look";
      callId: string;
      page: number;
      box: Box | null;
    }
  | {
      /**
       * Written twice per run_code or run_check: before it runs, with exitCode
       * CODE_PENDING, then with the result. Keep the last per callId.
       */
      type: "code";
      callId: string;
      /** The named Check, or null for code the Examiner wrote. */
      check: CheckId | null;
      /** The Python that ran (for a Check: the one-line call into the Toolkit). */
      code: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      ms: number;
    }
  | { type: "measurements"; measurements: Measurement[] }
  | { type: "hypothesis"; hypothesis: Hypothesis }
  | { type: "skill"; skill: SkillId }
  | {
      /** The Findings and the Verdict as they stand; written whenever they change. */
      type: "findings";
      findings: Finding[];
      verdict: VerdictResult;
      rulebookVersion: number;
    }
  | { type: "gate"; gate: DoneGate }
  | {
      type: "cost";
      model: string;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      ms: number;
    }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | {
      /** A Re-evaluate under another Rulebook version: no model, no Sandbox. */
      type: "reevaluated";
      fromVersion: number;
      toVersion: number;
      from: Verdict;
      to: Verdict;
    }
  | {
      type: "end";
      status: "completed" | "failed" | "stopped";
      verdict?: Verdict;
      error?: string;
      gatePassed?: boolean;
      stoppedBy?: StopReason;
      score?: Score;
    }
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type TrailEventInput = DistributiveOmit<TrailEvent, "at">;
export type StoredEvent = TrailEvent & { seq: number };

// The Corpus and scoring ------------------------------------------------------------------

export const TAMPER_TYPES = {
  text_edit: "Amount edited in the text layer",
  overpaint_edit: "Patch painted over the old text, new text on top",
  font_substitution: "Text replaced in another font",
  incremental_update: "Edit appended as an incremental update",
  date_change: "Date changed",
  payee_change: "Name or payee altered",
  pasted_patch: "Image patch pasted in",
  copy_move: "Region copied over another",
  resaved_region: "Region re-saved at another quality",
  recompressed_splice: "Splice from another JPEG, then re-saved",
  browser_edit: "Edited on the Forge bench",
} as const;
export type TamperType = keyof typeof TAMPER_TYPES;

/** One recorded alteration: ground truth, never shown to the Examiner. */
export type Tamper = {
  type: TamperType;
  page: number;
  box: Box;
  /** What it says now and what it said before, when it is a text change. */
  field?: string;
  from?: string;
  to?: string;
};

export const BENIGN_TYPES = {
  rescan: "Re-saved by a scanner: whole page recompressed",
  resave_pdf: "Printed to PDF again by an office tool, content untouched",
  screenshot: "A screenshot of the document, saved as an image",
} as const;
export type BenignType = keyof typeof BENIGN_TYPES;

/** One Corpus Document's entry in the Manifest. */
export type ManifestEntry = {
  id: string;
  /** The genuine original it was made from (itself for an original). */
  baseId: string;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  split: Split;
  /** File under fixtures/loupe/corpus/. */
  file: string;
  pages: number;
  /** The fictional issuer. */
  issuer: string;
  /** Empty for a genuine Document. */
  tampers: Tamper[];
  /** Benign processing applied, if any. */
  benign: BenignType[];
  /** True when the Sweep is not expected to catch it (an in-place edit that keeps every number consistent). */
  hard: boolean;
  /** Shown on the page as a Sample. */
  featured: boolean;
  /** One line for the Sample card, which never says whether it was tampered with. */
  blurb: string;
};

/** A Sample as a card in the picker. Says nothing about tampering. */
export type SampleCard = {
  id: string;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  issuer: string;
  blurb: string;
  pages: PageInfo[];
  /** The file itself, for the Forge bench and for downloading. */
  file: string;
};

/** How an Examination did against the Manifest (a Sample) or the Edits (a Forgery). */
export type Score = {
  /** What the Document truly is. */
  truth: "genuine" | "tampered";
  verdict: Verdict;
  /** Genuine called Genuine, or tampered called Suspicious or Tampered. */
  correct: boolean;
  tampers: number;
  /** Tampers with a Finding on them. */
  caught: number;
  /** Findings that touch no Tamper (context Findings are not counted). */
  falseFindings: number;
  perTamper: {
    type: TamperType;
    page: number;
    box: Box;
    field?: string;
    caught: boolean;
    /** The Finding that caught it. */
    findingId: string | null;
  }[];
};

// What the server hands the page ------------------------------------------------------------

export type ExaminationSummary = {
  id: string;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  source: DocumentSource;
  /** True when the Document is a Forgery from the bench. */
  forgery: boolean;
  status: ExaminationStatus;
  startedAt: string;
  endedAt: string | null;
  model: string;
  driver: Driver;
  /** The Rulebook version the current Verdict was decided under. */
  rulebookVersion: number;
  costUsd: number;
  verdict: Verdict | null;
  findings: number;
  score: Score | null;
  gatePassed: boolean | null;
  stoppedBy: StopReason | null;
  error: string | null;
};

export type ExaminationDetail = ExaminationSummary & {
  pages: PageInfo[];
  measurements: Measurement[];
  hypotheses: Hypothesis[];
  findingList: Finding[];
  verdictResult: VerdictResult | null;
  gate: DoneGate | null;
  /** The Trail so far, in order. */
  events: StoredEvent[];
};

/** A Forgery's ground truth: the Sample it was made from and what the visitor changed. */
export type Forgery = {
  sampleId: string;
  edits: Edit[];
};

export const EDIT_KINDS = {
  text: "Changed text",
  patch: "Pasted patch",
  erase: "Erased",
} as const;
export type EditKind = keyof typeof EDIT_KINDS;

export type Edit = {
  kind: EditKind;
  page: number;
  box: Box;
  /** For a text Edit: what the visitor typed. */
  to?: string;
};

export const editSchema = z.object({
  kind: z.enum(Object.keys(EDIT_KINDS) as [EditKind, ...EditKind[]]),
  page: z.number().int().min(1).max(20),
  box: boxSchema,
  to: z.string().max(80).optional(),
});

export type UploadSummary = {
  id: string;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  bytes: number;
  forgery: Forgery | null;
  createdAt: string;
};
