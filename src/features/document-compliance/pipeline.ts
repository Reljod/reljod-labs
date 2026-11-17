import { rulebookFromApplied, ruleSpec } from "./domain/rules";
import type { DocumentKind } from "./domain/types";
import { OUTCOME_LABELS } from "./domain/types";
import { formatMs, formatPercent, formatTokens, formatUsd } from "./metrics";
import { DOCUMENT_ORDER } from "./scan-events";
import type { EvaluationView, RunView } from "./view";

/**
 * The Pre-screen as a graph (ADR 0019): each Document runs Parse → Read →
 * Verify → Field checks in its own lane, and the lanes join at Evaluate and
 * Findings. Only Read calls the model; every other step is code.
 */
export type PipelineStage =
  | "parse"
  | "read"
  | "verify"
  | "check"
  | "evaluate"
  | "findings";

export type PipelineNode = {
  id: string;
  stage: PipelineStage;
  /** The Document whose lane it is in; null for the steps after the join. */
  lane: DocumentKind | null;
  title: string;
  by: "code" | "model";
  state: "done" | "error" | "skipped";
  /** What the step produced, in a few words. */
  headline: string;
  /** What went in and what came out, for the detail panel. */
  rows: { label: string; value: string }[];
};

export type Pipeline = {
  lanes: { kind: DocumentKind; nodes: PipelineNode[] }[];
  join: PipelineNode[];
};

const STAGE_TITLES: Record<PipelineStage, string> = {
  parse: "Parse",
  read: "Read",
  verify: "Verify",
  check: "Field checks",
  evaluate: "Evaluate",
  findings: "Findings",
};

const node = (
  lane: DocumentKind | null,
  stage: PipelineStage,
  rest: Pick<PipelineNode, "by" | "state" | "headline" | "rows">,
): PipelineNode => ({
  id: lane ? `${lane}-${stage}` : stage,
  stage,
  lane,
  title: STAGE_TITLES[stage],
  ...rest,
});

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** The graph of one run under one of its Evaluations. */
export function pipelineOf(
  view: RunView,
  evaluation: EvaluationView,
  kinds: DocumentKind[] = DOCUMENT_ORDER,
): Pipeline {
  const rulebook = rulebookFromApplied(evaluation.rules);
  const failed = view.status === "failed";

  const lanes = kinds.map((kind) => {
    const document = view.documents.find((item) => item.kind === kind);
    if (!document) {
      const missing = (stage: PipelineStage, by: PipelineNode["by"]) =>
        node(kind, stage, {
          by,
          state: failed ? "error" : "skipped",
          headline: failed ? "not finished" : "not run",
          rows: [],
        });
      return {
        kind,
        nodes: [
          missing("parse", "code"),
          missing("read", "model"),
          missing("verify", "code"),
          missing("check", "code"),
        ],
      };
    }

    const metrics = document.metrics;
    const verified = document.fields.filter((field) => field.verified);
    const confident = verified.filter(
      (field) => (field.confidence ?? 0) >= rulebook.minFieldConfidence,
    );
    const unverified = document.fields.filter((field) => !field.verified);
    const checks = evaluation.checks.filter(
      (check) => check.documentKind === kind,
    );
    const countOf = (outcome: string) =>
      checks.filter((check) => check.outcome === outcome).length;

    return {
      kind,
      nodes: [
        node(kind, "parse", {
          by: "code",
          state: "done",
          headline: `${plural(document.spans.length, "span")} · ${document.parser}`,
          rows: [
            { label: "Parser", value: document.parser },
            { label: "Pages", value: String(document.pageCount) },
            { label: "Spans", value: String(document.spans.length) },
            { label: "Took", value: formatMs(metrics?.parseMs ?? null) },
          ],
        }),
        node(kind, "read", {
          by: "model",
          state: "done",
          headline: `${plural(document.fields.length, "field")} · ${formatUsd(metrics?.costUsd ?? null)}`,
          rows: [
            { label: "Model", value: metrics?.model ?? view.model ?? "-" },
            { label: "Provider", value: metrics?.provider ?? "-" },
            { label: "Fields read", value: String(document.fields.length) },
            {
              label: "Tokens in / out",
              value: `${formatTokens(metrics?.inputTokens ?? null)} / ${formatTokens(metrics?.outputTokens ?? null)}`,
            },
            { label: "Cost", value: formatUsd(metrics?.costUsd ?? null) },
            { label: "Took", value: formatMs(metrics?.readMs ?? null) },
            {
              label: "Legible",
              value: document.judgments.legible ? "yes" : "no",
            },
            {
              label: "Tampering suspected",
              value: document.judgments.tamperingSuspected ? "yes" : "no",
            },
          ],
        }),
        node(kind, "verify", {
          by: "code",
          state: "done",
          headline: `${verified.length}/${document.fields.length} found on the page`,
          rows: [
            {
              label: "Found in their spans",
              value: `${verified.length} of ${document.fields.length}`,
            },
            {
              label: `At least ${formatPercent(rulebook.minFieldConfidence)} sure`,
              value: `${confident.length} of ${verified.length}`,
            },
            {
              label: "Not found on the page",
              value: unverified.map((field) => field.name).join(", ") || "none",
            },
          ],
        }),
        node(kind, "check", {
          by: "code",
          state: "done",
          headline: `${countOf("pass")} pass · ${countOf("fail")} fail · ${countOf("needs_review")} review`,
          rows: checks.map((check) => ({
            label: check.fieldName,
            value: `${check.outcome === "read" ? "read" : OUTCOME_LABELS[check.outcome]}: ${check.note}${check.expected ? ` (expected ${check.expected})` : ""}`,
          })),
        }),
      ],
    };
  });

  const findings = evaluation.findings;
  const edited = evaluation.rules.filter((rule) => rule.version > 0);
  const off = evaluation.rules.filter((rule) => !rule.enabled);
  const count = (outcome: keyof typeof OUTCOME_LABELS) =>
    findings.filter((finding) => finding.outcome === outcome).length;
  const reviewed = new Set(
    view.reviews
      .filter((review) => review.evaluation === evaluation.number)
      .map((review) => review.requirementId),
  );
  const flagged = findings.filter((finding) => finding.outcome !== "pass");

  const join = [
    node(null, "evaluate", {
      by: "code",
      state: failed ? "error" : "done",
      headline: `${plural(rulebook.requirements.length, "Requirement")}${edited.length > 0 ? ` · ${edited.length} edited` : ""}`,
      rows: [
        {
          label: "Evaluation",
          value: `${evaluation.number}${evaluation.createdBy ? ` · by ${evaluation.createdBy}` : " · the run's own"}`,
        },
        ...evaluation.rules.map((rule) => {
          const finding = findings.find(
            (item) =>
              item.requirementId === ruleSpec(rule.ruleId).requirementId,
          );
          return {
            label: `${rule.ruleId} v${rule.version}`,
            value: !rule.enabled
              ? "Off"
              : finding
                ? OUTCOME_LABELS[finding.outcome]
                : "applies to every check",
          };
        }),
        ...(off.length > 0
          ? [
              {
                label: "Switched off",
                value: off.map((rule) => rule.ruleId).join(", "),
              },
            ]
          : []),
      ],
    }),
    node(null, "findings", {
      by: "code",
      state: failed ? "error" : "done",
      headline: `${count("pass")} pass · ${count("fail")} fail · ${count("needs_review")} review`,
      rows: [
        { label: "Pass", value: String(count("pass")) },
        { label: "Fail", value: String(count("fail")) },
        { label: "Needs review", value: String(count("needs_review")) },
        {
          label: "Settled by a Reviewer",
          value: `${flagged.filter((finding) => reviewed.has(finding.requirementId)).length} of ${flagged.length} flagged`,
        },
      ],
    }),
  ];

  return { lanes, join };
}
