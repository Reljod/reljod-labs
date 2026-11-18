/**
 * Loupe's Rules are data (ADR 0015, ADR 0027): one Rule per Metric, with the
 * threshold it is held to, the Document kinds it applies to and its Weight,
 * plus the Policy that turns Findings into a Verdict and says what is benign.
 * Defaults live here; an Owner's edit saves a new Rulebook version. The
 * checks that read them are code in `evaluate.ts`.
 */
import { z } from "zod";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  METRIC_IDS,
  METRICS,
  type MetricId,
  WEIGHTS,
  type Weight,
} from "./contract";

const kindSchema = z.enum(
  DOCUMENT_KINDS as unknown as [DocumentKind, ...DocumentKind[]],
);

export const ruleSchema = z.object({
  enabled: z.boolean(),
  /** A Measurement at or above this trips the Rule. */
  threshold: z.number().finite().min(0).max(1_000_000),
  weight: z.enum(WEIGHTS as unknown as [Weight, ...Weight[]]),
  /** The Document kinds it applies to; empty means every kind. */
  kinds: z.array(kindSchema).max(DOCUMENT_KINDS.length),
});
export type Rule = z.infer<typeof ruleSchema>;

const producerList = z
  .array(z.string().trim().min(2).max(80))
  .max(60)
  .transform((items) => [...new Set(items)]);

export const policySchema = z.object({
  /** This many supporting Findings make a Document Tampered without a decisive one. */
  tamperedAtSupporting: z.number().int().min(1).max(20),
  /** This many supporting Findings make a Document Suspicious. */
  suspiciousAtSupporting: z.number().int().min(1).max(20),
  /**
   * Whether a Measurement from code the Examiner wrote itself may be
   * decisive. Off, it counts as supporting at most: only a named Check, which
   * anyone can run again, makes a Document Tampered alone.
   */
  ownCodeDecisive: z.boolean(),
  /** Software that edits documents. A file written by one trips `pdf.editor_producer`. */
  editors: producerList,
  /** Scanners, print drivers and office tools. A file written by one is a benign re-save. */
  benignProducers: producerList,
  /**
   * A pixel Finding covering at least this share of the page is a whole-page
   * effect (a scanner re-save, a screenshot) and counts as context only.
   */
  wholePageShare: z.number().min(0.2).max(1),
});
export type Policy = z.infer<typeof policySchema>;

export const rulebookSchema = z
  .object({
    rules: z.object(
      Object.fromEntries(METRIC_IDS.map((id) => [id, ruleSchema])) as Record<
        MetricId,
        typeof ruleSchema
      >,
    ),
    policy: policySchema,
  })
  .refine(
    (book) =>
      book.policy.suspiciousAtSupporting <= book.policy.tamperedAtSupporting,
    {
      message:
        "Suspicious must not need more supporting Findings than Tampered.",
      path: ["policy", "suspiciousAtSupporting"],
    },
  );
export type Rulebook = z.infer<typeof rulebookSchema>;

/**
 * How each Rule reads, and the bounds its threshold may be edited within.
 * `{threshold}` is replaced by the Rule's value. `scale` says how a
 * Finding's confidence follows from its Measurement (evaluate.ts).
 */
export const RULE_TEXT: Record<
  MetricId,
  {
    sentence: string;
    min: number;
    max: number;
    step: number;
    scale: "count" | "ratio" | "amount";
    why: string;
  }
> = {
  "pdf.incremental_updates": {
    sentence:
      "A PDF saved again {threshold} or more times after it was issued, with its content changed, is flagged.",
    min: 1,
    max: 10,
    step: 1,
    scale: "count",
    why: "An issuer's system writes a document once. A later save that replaces content is an edit, and the earlier version is still in the file.",
  },
  "pdf.editor_producer": {
    sentence: "A PDF written by an editing tool on the editors list is flagged.",
    min: 1,
    max: 1,
    step: 1,
    scale: "count",
    why: "Payroll and banking systems name themselves in the file. An editor's name means someone opened it and saved it.",
  },
  "pdf.modified_gap_hours": {
    sentence:
      "A PDF modified {threshold} hours or more after it was created is flagged.",
    min: 1,
    max: 8760,
    step: 1,
    scale: "amount",
    why: "On its own this is weak: archiving and re-downloading also touch the date. It is context for the other Findings.",
  },
  "pdf.covered_text": {
    sentence:
      "{threshold} or more text runs hidden under an opaque patch with other text on top are flagged.",
    min: 1,
    max: 20,
    step: 1,
    scale: "count",
    why: "The old figure is still in the file under a white box. No issuer prints a figure, covers it and prints another.",
  },
  "pdf.text_over_image": {
    sentence:
      "{threshold} or more live text runs drawn over a full-page scan are flagged.",
    min: 1,
    max: 50,
    step: 1,
    scale: "count",
    why: "A scan is pixels. Sharp live text on top of it was added afterwards.",
  },
  "pdf.annotations": {
    sentence:
      "{threshold} or more free-text, stamp or redaction annotations over printed content are flagged.",
    min: 1,
    max: 20,
    step: 1,
    scale: "count",
    why: "Annotations are the easiest way to put new words over old ones without touching the page content.",
  },
  "glyph.font_outlier": {
    sentence:
      "A text run whose font is out of place among its neighbours by a score of {threshold} or more is flagged.",
    min: 0.05,
    max: 1,
    step: 0.05,
    scale: "ratio",
    why: "An edited figure rarely gets the issuer's exact font back: the editor substitutes one that looks close.",
  },
  "glyph.size_delta_pt": {
    sentence:
      "A text run {threshold} pt or more larger or smaller than its neighbours is flagged.",
    min: 0.05,
    max: 10,
    step: 0.05,
    scale: "ratio",
    why: "Columns of figures are set at one size. A retyped figure is often a fraction of a point off.",
  },
  "glyph.baseline_offset_pt": {
    sentence:
      "A text run sitting {threshold} pt or more off its line's baseline is flagged.",
    min: 0.05,
    max: 10,
    step: 0.05,
    scale: "ratio",
    why: "Text placed by hand lands a little above or below the line the layout engine set.",
  },
  "glyph.spacing_outlier": {
    sentence:
      "A text run whose letter spacing is {threshold} standard deviations or more from its font's is flagged.",
    min: 1,
    max: 20,
    step: 0.5,
    scale: "ratio",
    why: "Editors re-space characters when they replace them; the issuer's own spacing is uniform.",
  },
  "glyph.color_delta": {
    sentence:
      "A text run whose ink differs from its neighbours' by {threshold} or more is flagged.",
    min: 1,
    max: 255,
    step: 1,
    scale: "ratio",
    why: "A figure typed in 'black' is often not the same black the document was printed in.",
  },
  "image.ela_ratio": {
    sentence:
      "A region whose error level is {threshold}× the page's or more is flagged.",
    min: 1.1,
    max: 20,
    step: 0.1,
    scale: "ratio",
    why: "A whole-page re-save changes every block alike. A pasted or separately saved region changes by a different amount.",
  },
  "image.noise_ratio": {
    sentence:
      "A region {threshold}× quieter or louder than the page's noise, or more, is flagged.",
    min: 1.1,
    max: 30,
    step: 0.1,
    scale: "ratio",
    why: "A scanner lays the same grain over the whole sheet. Digits drawn in an editor have none.",
  },
  "image.jpeg_ghost": {
    sentence:
      "A region with a second compression history scoring {threshold} or more is flagged.",
    min: 0.05,
    max: 1,
    step: 0.05,
    scale: "ratio",
    why: "A patch cut from another JPEG keeps that file's compression grid inside this one.",
  },
  "image.copy_move": {
    sentence:
      "A duplicated area of {threshold}% of the page or more is flagged.",
    min: 0.01,
    max: 20,
    step: 0.01,
    scale: "ratio",
    why: "Copying a digit from elsewhere on the page keeps the grain right, but two areas of a scan are never identical pixel for pixel.",
  },
  "image.edge_halo": {
    sentence:
      "A region whose text halo is {threshold}× the page's or more is flagged.",
    min: 1.1,
    max: 20,
    step: 0.1,
    scale: "ratio",
    why: "Pasted text carries the anti-aliasing and background of where it came from.",
  },
  "arith.sum_mismatch": {
    sentence:
      "A total that differs from the sum of its lines by M$ {threshold} or more is flagged.",
    min: 0.01,
    max: 10_000,
    step: 0.01,
    scale: "amount",
    why: "Systems add up. A forger changes the figure that matters and forgets the ones that depend on it.",
  },
  "arith.balance_break": {
    sentence:
      "A running balance that is off by M$ {threshold} or more is flagged.",
    min: 0.01,
    max: 10_000,
    step: 0.01,
    scale: "amount",
    why: "Every balance on a statement follows from the one above it. One edited transaction breaks the chain.",
  },
  "arith.rate_mismatch": {
    sentence:
      "A tax or deduction that differs from its stated rate by M$ {threshold} or more is flagged.",
    min: 0.01,
    max: 10_000,
    step: 0.01,
    scale: "amount",
    why: "Rounding differs between systems, so this is supporting evidence rather than proof.",
  },
  "format.date_anomaly": {
    sentence:
      "{threshold} or more dates that contradict the document's own period or order are flagged.",
    min: 1,
    max: 20,
    step: 1,
    scale: "count",
    why: "A transaction dated outside its statement, or a payslip paid before its period ended, did not come from the issuer.",
  },
  "format.style_break": {
    sentence:
      "{threshold} or more fields formatted unlike the same kind of field elsewhere are flagged.",
    min: 1,
    max: 20,
    step: 1,
    scale: "count",
    why: "One figure with a different separator or one date in another order was typed by a person.",
  },
  "id.checksum_invalid": {
    sentence:
      "{threshold} or more account, tax or document numbers whose check digits fail are flagged.",
    min: 1,
    max: 20,
    step: 1,
    scale: "count",
    why: "Check digits exist to catch a changed digit. An issuer never prints a number that fails its own check.",
  },
};

const ALL: DocumentKind[] = [];

function rule(
  threshold: number,
  weight: Weight,
  kinds: DocumentKind[] = ALL,
): Rule {
  return { enabled: true, threshold, weight, kinds };
}

/**
 * The Defaults. Thresholds were tuned on the Corpus's train and validation
 * splits only (fixtures/loupe/tuning.json, `golden.test.ts`); the test split
 * is reported, never tuned on.
 */
export const DEFAULT_RULEBOOK: Rulebook = {
  rules: {
    "pdf.incremental_updates": rule(1, "decisive"),
    "pdf.editor_producer": rule(1, "supporting"),
    "pdf.modified_gap_hours": rule(24, "context"),
    "pdf.covered_text": rule(1, "decisive"),
    "pdf.text_over_image": rule(1, "supporting"),
    "pdf.annotations": rule(1, "supporting"),
    "glyph.font_outlier": rule(0.6, "supporting"),
    "glyph.size_delta_pt": rule(0.4, "supporting"),
    "glyph.baseline_offset_pt": rule(0.5, "supporting"),
    "glyph.spacing_outlier": rule(4, "supporting"),
    "glyph.color_delta": rule(24, "supporting"),
    "image.ela_ratio": rule(3, "supporting"),
    "image.noise_ratio": rule(3, "supporting"),
    "image.jpeg_ghost": rule(0.5, "supporting"),
    "image.copy_move": rule(0.05, "supporting"),
    "image.edge_halo": rule(2.5, "supporting"),
    "arith.sum_mismatch": rule(0.02, "decisive", [
      "payslip",
      "invoice",
      "utility_bill",
      "bank_statement",
      "other",
    ]),
    "arith.balance_break": rule(0.02, "decisive", ["bank_statement", "other"]),
    "arith.rate_mismatch": rule(0.06, "supporting", [
      "payslip",
      "invoice",
      "utility_bill",
      "other",
    ]),
    "format.date_anomaly": rule(1, "supporting"),
    "format.style_break": rule(1, "supporting"),
    "id.checksum_invalid": rule(1, "supporting"),
  },
  policy: {
    tamperedAtSupporting: 2,
    suspiciousAtSupporting: 1,
    ownCodeDecisive: false,
    editors: [
      "Meridia PDF Editor",
      "QuickEdit PDF",
      "PixelForge",
      "Acrobat",
      "Photoshop",
      "GIMP",
      "Illustrator",
      "Inkscape",
      "iLovePDF",
      "Sejda",
      "PDFescape",
      "Smallpdf",
      "PDF-XChange",
      "Foxit PhantomPDF",
      "Foxit PDF Editor",
      "Nitro",
      "Canva",
      "LibreOffice Draw",
      "Preview",
      "pdf-lib",
      "PyMuPDF",
    ],
    benignProducers: [
      "Meridia Office Print to PDF",
      "Selene ScanStation",
      "Microsoft: Print To PDF",
      "Quartz PDFContext",
      "cairo",
      "Ghostscript",
      "Chromium",
      "Skia/PDF",
    ],
    wholePageShare: 0.6,
  },
};

/** The Rule's sentence with its threshold filled in. */
export function ruleSentence(metric: MetricId, threshold: number) {
  return RULE_TEXT[metric].sentence.replace(
    "{threshold}",
    formatThreshold(threshold),
  );
}

export function formatThreshold(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** A Rulebook as valid data, or the first problems with it in plain words. */
export function parseRulebook(
  input: unknown,
): { ok: true; rulebook: Rulebook } | { ok: false; error: string } {
  const parsed = rulebookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "rulebook"}: ${issue.message}`)
        .join("; "),
    };
  }
  for (const id of METRIC_IDS) {
    const { min, max } = RULE_TEXT[id];
    const { threshold } = parsed.data.rules[id];
    if (threshold < min || threshold > max) {
      return {
        ok: false,
        error: `${METRICS[id].label}: the threshold must be between ${formatThreshold(min)} and ${formatThreshold(max)}.`,
      };
    }
  }
  return { ok: true, rulebook: parsed.data };
}

/** One Rule changed; everything else as it was. For the MCP tool and the Rule cards. */
export function withRule(
  rulebook: Rulebook,
  metric: MetricId,
  patch: Partial<Rule>,
): Rulebook {
  return {
    ...rulebook,
    rules: {
      ...rulebook.rules,
      [metric]: { ...rulebook.rules[metric], ...patch },
    },
  };
}

/** What differs between two Rulebooks, one line each, for the history and the Audit trail. */
export function diffRulebooks(before: Rulebook, after: Rulebook): string[] {
  const lines: string[] = [];
  for (const id of METRIC_IDS) {
    const a = before.rules[id];
    const b = after.rules[id];
    const label = METRICS[id].label;
    if (a.enabled !== b.enabled)
      lines.push(`${label}: ${b.enabled ? "turned on" : "turned off"}`);
    if (a.threshold !== b.threshold)
      lines.push(
        `${label}: threshold ${formatThreshold(a.threshold)} → ${formatThreshold(b.threshold)}`,
      );
    if (a.weight !== b.weight)
      lines.push(`${label}: ${a.weight} → ${b.weight}`);
    if ([...a.kinds].sort().join() !== [...b.kinds].sort().join())
      lines.push(
        `${label}: applies to ${b.kinds.length ? b.kinds.join(", ") : "every kind"}`,
      );
  }
  const p = before.policy;
  const q = after.policy;
  if (p.tamperedAtSupporting !== q.tamperedAtSupporting)
    lines.push(
      `Tampered at ${p.tamperedAtSupporting} → ${q.tamperedAtSupporting} supporting Findings`,
    );
  if (p.suspiciousAtSupporting !== q.suspiciousAtSupporting)
    lines.push(
      `Suspicious at ${p.suspiciousAtSupporting} → ${q.suspiciousAtSupporting} supporting Findings`,
    );
  if (p.ownCodeDecisive !== q.ownCodeDecisive)
    lines.push(
      `The Examiner's own code ${q.ownCodeDecisive ? "may" : "may not"} be decisive`,
    );
  if (p.wholePageShare !== q.wholePageShare)
    lines.push(
      `Whole-page share ${formatThreshold(p.wholePageShare)} → ${formatThreshold(q.wholePageShare)}`,
    );
  if (p.editors.join("|") !== q.editors.join("|"))
    lines.push(`Editors list: ${q.editors.length} entries`);
  if (p.benignProducers.join("|") !== q.benignProducers.join("|"))
    lines.push(`Benign producers list: ${q.benignProducers.length} entries`);
  return lines;
}

export type RulebookVersion = {
  version: number;
  rulebook: Rulebook;
  createdAt: string;
  /** null for the built-in Defaults (version 0). */
  note: string | null;
  /** What changed against the version before it. */
  changes: string[];
};
