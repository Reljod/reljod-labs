import { z } from "zod";
import { CHECK_IDS } from "./checks";
import { DOCUMENT_KIND_IDS } from "./document-kinds";

export const SCENARIOS = [
  "pension_withdrawal",
  "employer_onboarding",
  "structure_review",
  "screening_review",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** How a fixture Document is produced from its source. */
export const RENDERS = ["pdf", "scan", "photo", "csv"] as const;

export const caseDocumentSchema = z.object({
  /** Source file in the case folder: `.html` for pdf/scan/photo, `.csv` for csv. */
  source: z.string(),
  /** File name shown in the Cabinet, with its extension (`.pdf`, `.jpg`, `.csv`). */
  name: z.string(),
  kind: z.enum(DOCUMENT_KIND_IDS),
  render: z.enum(RENDERS),
  /** Expected Read output: field name to value, using the kind's fields only. */
  label: z.record(z.string(), z.unknown()),
});

export const caseFileSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  scenario: z.enum(SCENARIOS),
  /** Folder name in the Cabinet. */
  title: z.string(),
  /** One sentence: what this case is about and what is wrong with it, if anything. */
  summary: z.string(),
  /** The date the review happens on; every "in date" check uses it. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  documents: z.array(caseDocumentSchema).min(1),
  expected: z.object({
    pipeline: z.enum(SCENARIOS),
    recommendation: z.enum(["approve", "refer", "decline", "request_info"]),
    /** Document kinds deliberately left out, which should make the Specialist ask. */
    missingKinds: z.array(z.enum(DOCUMENT_KIND_IDS)),
    /** The checks that matter for this case, with the expected outcome. */
    checks: z.array(
      z.object({
        id: z.enum(CHECK_IDS),
        outcome: z.enum(["pass", "fail", "review"]),
        note: z.string(),
      }),
    ),
    /** Screening: each hit and how it should be disposed of. */
    hits: z
      .array(
        z.object({
          name: z.string(),
          disposition: z.enum(["false_positive", "true_match", "inconclusive"]),
          reason: z.string(),
        }),
      )
      .optional(),
    risk: z.enum(["low", "standard", "high"]).optional(),
    /** Employer: total arrears owed in CI$ (contributions only, before interest). */
    arrears: z.number().optional(),
    /** Structure: natural persons owning or controlling at 10%+ (or controllers of a trust). */
    ubos: z.array(z.string()).optional(),
  }),
});

export type CaseFile = z.infer<typeof caseFileSchema>;
export type CaseDocument = z.infer<typeof caseDocumentSchema>;
