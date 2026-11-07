"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import type { FieldCheck } from "../../domain/field-checks";
import type { DocumentKind, Outcome } from "../../domain/types";
import type { FindingView, RunView } from "../../view";
import { DocumentViewer } from "../document-viewer";
import {
  CHECK_STYLES,
  DOCUMENT_SHORT_LABELS,
  FIELD_LABELS,
  OUTCOME_STYLES,
} from "../labels";

const OUTCOMES: Outcome[] = ["fail", "needs_review", "pass"];

function CountUp({ to, reduceMotion }: { to: number; reduceMotion: boolean }) {
  const value = useMotionValue(reduceMotion ? to : 0);
  const rounded = useTransform(value, (latest) => Math.round(latest));
  useEffect(() => {
    if (reduceMotion) return;
    const controls = animate(value, to, { duration: 0.9, ease: "easeOut" });
    return () => controls.stop();
  }, [to, value, reduceMotion]);
  return <motion.span>{rounded}</motion.span>;
}

/** The Field checks behind a Finding's Evidence: read value against expected. */
function EvidenceDiff({
  finding,
  checks,
}: {
  finding: FindingView;
  checks: FieldCheck[];
}) {
  const cited = finding.evidence.flatMap((evidence) => {
    const check = checks.find(
      (item) =>
        item.documentKind === evidence.documentKind &&
        item.fieldName === evidence.fieldName,
    );
    return check ? [check] : [];
  });
  if (cited.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {cited.map((check) => {
        const style = CHECK_STYLES[check.outcome];
        const issue =
          check.outcome === "fail" || check.outcome === "needs_review";
        return (
          <span
            key={`${check.documentKind}-${check.fieldName}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-ink bg-paper px-1.5 py-0.5 font-mono text-[11px]"
          >
            <span
              className={`grid size-4 shrink-0 place-items-center rounded-[1px] font-bold ${style.chip}`}
            >
              {style.mark}
            </span>
            <span className="text-ink-muted">
              {DOCUMENT_SHORT_LABELS[check.documentKind]} ·{" "}
              {FIELD_LABELS[check.fieldName]}
            </span>
            <span className={`truncate font-bold ${issue ? style.text : ""}`}>
              {check.value}
            </span>
            {issue && check.expected ? (
              <span className="truncate text-ink-muted">
                ≠ {check.expected}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

type FindingsReportProps = {
  view: RunView;
  reduceMotion: boolean;
};

/** The finished run: every Finding with its reason, and its Evidence on the page. */
export function FindingsReport({ view, reduceMotion }: FindingsReportProps) {
  const [selected, setSelected] = useState<FindingView | null>(null);
  const [activeKind, setActiveKind] =
    useState<DocumentKind>("identity_document");
  const checks = view.documents.flatMap((document) => document.checks);
  const count = (outcome: Outcome) =>
    view.findings.filter((finding) => finding.outcome === outcome).length;

  function selectFinding(finding: FindingView) {
    setSelected(finding);
    const first = finding.evidence[0];
    if (first) setActiveKind(first.documentKind);
  }

  // Flagged Findings first: they are what a Reviewer acts on.
  const ordered = [...view.findings].sort(
    (a, b) => OUTCOMES.indexOf(a.outcome) - OUTCOMES.indexOf(b.outcome),
  );

  return (
    <section
      aria-labelledby="findings-title"
      data-testid="findings-report"
      data-run-status={view.status}
      className="flex flex-col gap-6"
    >
      <h2 id="findings-title" className="sr-only">
        Findings
      </h2>

      {view.status === "failed" ? (
        <p
          role="alert"
          data-testid="run-notice"
          className="outline-box rounded-sm bg-limestone px-4 py-3 font-mono text-sm"
        >
          ✕ {view.error}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {OUTCOMES.map((outcome, index) => (
            <motion.div
              key={outcome}
              data-testid={`count-${outcome}`}
              initial={reduceMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08 }}
              className={`outline-box flex flex-col rounded-sm p-3 shadow-hard-md sm:p-4 ${OUTCOME_STYLES[outcome].className}`}
            >
              <span className="font-mono text-3xl font-bold sm:text-5xl">
                <CountUp to={count(outcome)} reduceMotion={reduceMotion} />
              </span>
              <span className="eyebrow">{OUTCOME_STYLES[outcome].label}</span>
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ol className="flex flex-col gap-3">
          {ordered.map((finding, index) => {
            const style = OUTCOME_STYLES[finding.outcome];
            const isSelected =
              selected?.requirementId === finding.requirementId;
            return (
              <motion.li
                key={finding.requirementId}
                initial={reduceMotion ? false : { opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + index * 0.05 }}
              >
                <button
                  type="button"
                  data-testid={`finding-${finding.requirementId}`}
                  data-outcome={finding.outcome}
                  aria-pressed={isSelected}
                  onClick={() => selectFinding(finding)}
                  className={`outline-box press flex w-full flex-col gap-2 rounded-sm border-l-8 p-3 text-left ${
                    finding.outcome === "fail"
                      ? "border-l-seal-red"
                      : finding.outcome === "needs_review"
                        ? "border-l-brass"
                        : "border-l-ivy"
                  } ${isSelected ? "bg-morning-haze" : "bg-paper"}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-mono text-sm font-bold uppercase">
                      {finding.title}
                    </span>
                    <span
                      className={`outline-box eyebrow shrink-0 rounded-sm px-2 py-0.5 ${style.className}`}
                    >
                      {style.label}
                    </span>
                  </span>
                  <span className="text-sm">{finding.reason}</span>
                  <EvidenceDiff finding={finding} checks={checks} />
                </button>
              </motion.li>
            );
          })}
        </ol>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <DocumentViewer
            documents={view.documents}
            activeKind={activeKind}
            onSelectKind={setActiveKind}
            finding={selected}
          />
        </div>
      </div>
    </section>
  );
}
