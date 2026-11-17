import type { SourceKind } from "../knowledge";
import { SEED_TEXTS } from "./seed-texts";
import { type DraftPassage, splitSource } from "./split";

/**
 * The Knowledge base a new Workspace starts with: the seed Sources of
 * Harbour Bank & Trust's pension plan. Their text is `fixtures/harness/
 * knowledge/<key>.md`, built into `seed-texts.ts` by
 * `scripts/build-harness-knowledge.mts` so a Vercel function needs no file.
 *
 * The facts follow `fixtures/harness/RULES-REFERENCE.md`, with one
 * deliberate exception: the Member Guide is an older edition (1 March 2023)
 * that still states the CI$35,000 property withdrawal cap. Adding the sample
 * Circular 2023-07 (CI$50,000 and CI$100,000 from 9 December 2023) raises a
 * real Conflict, and "the new one supersedes" is the right Resolution.
 *
 * To add a seed Source, add it to `META` and raise `SEED_VERSION` in
 * `server/workspace.ts`: the `seed_key` makes topping up a Workspace safe to
 * run twice.
 */
export type SeedSource = {
  /** Stable across Workspaces and releases: the `seed_key` column. */
  key: string;
  title: string;
  kind: SourceKind;
  /** The date the document itself carries. */
  documentDate: string;
  text: string;
};

const META: Omit<SeedSource, "text">[] = [
  {
    key: "employer-guide",
    title: "Employer Guide: Remitting Contributions",
    kind: "text",
    documentDate: "2024-02-01",
  },
  {
    key: "member-guide",
    title: "Member Guide: Retirement, Leaving Cayman and Property",
    kind: "text",
    documentDate: "2023-03-01",
  },
  {
    key: "forms-index",
    title: "Forms Index",
    kind: "text",
    documentDate: "2024-02-01",
  },
  {
    key: "member-requests-procedure",
    title: "Operations Procedure: Member Requests",
    kind: "text",
    documentDate: "2024-03-01",
  },
  {
    key: "delinquency-procedure",
    title: "Operations Procedure: Delinquent Contributions",
    kind: "text",
    documentDate: "2024-03-01",
  },
  {
    key: "member-faq",
    title: "Member-Service FAQ",
    kind: "text",
    documentDate: "2024-02-15",
  },
  {
    key: "rsa-guide",
    title: "Retirement Savings Arrangement Guide",
    kind: "text",
    documentDate: "2026-07-01",
  },
];

export const SEED_SOURCES: SeedSource[] = META.map((meta) => ({
  ...meta,
  text: SEED_TEXTS[meta.key] ?? "",
}));

/** A seed Source's Passages, the same way an uploaded one is split. */
export function seedPassages(source: SeedSource): DraftPassage[] {
  return splitSource(source.kind, source.text).passages;
}
