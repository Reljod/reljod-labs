"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { DocumentKind, Outcome } from "../domain/types";
import type { Pack } from "../packs";
import { getRun, startPrescreen } from "../server/actions";
import type { FindingView } from "../view";
import { DocumentViewer } from "./document-viewer";
import { OUTCOME_STYLES } from "./labels";

type PackSummary = Pick<Pack, "slug" | "title" | "flaw">;

export function PrescreenDemo({ packs }: { packs: PackSummary[] }) {
  const [packSlug, setPackSlug] = useState(packs[0]?.slug ?? "");
  const [runId, setRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<FindingView | null>(null);
  const [activeKind, setActiveKind] =
    useState<DocumentKind>("identity_document");

  const start = useMutation({
    mutationFn: startPrescreen,
    onMutate: () => {
      setRunId(null);
      setSelected(null);
      setNotice(null);
    },
    onSuccess: (result) => {
      setRunId(result.runId);
      if (result.status !== "completed") setNotice(result.message);
    },
    onError: (error) => setNotice(error.message),
  });

  const run = useQuery({
    queryKey: ["prescreen-run", runId],
    queryFn: () => (runId ? getRun(runId) : null),
    enabled: runId !== null,
  });

  function selectFinding(finding: FindingView) {
    setSelected(finding);
    const first = finding.evidence[0];
    if (first) setActiveKind(first.documentKind);
  }

  const view = run.data;
  const counts = (outcome: Outcome) =>
    view?.findings.filter((finding) => finding.outcome === outcome).length ?? 0;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="packs-title">
        <h2 id="packs-title" className="eyebrow mb-4 text-ink-muted">
          1. Choose a document pack
        </h2>
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="sr-only">Document pack</legend>
          {packs.map((pack) => (
            <label
              key={pack.slug}
              data-testid={`pack-option-${pack.slug}`}
              className={`outline-box flex cursor-pointer flex-col gap-2 rounded-sm p-4 ${
                pack.slug === packSlug
                  ? "bg-morning-haze shadow-hard-md"
                  : "bg-paper"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="pack"
                  value={pack.slug}
                  checked={pack.slug === packSlug}
                  onChange={() => setPackSlug(pack.slug)}
                  className="accent-federal-blue"
                />
                <span className="font-mono font-bold uppercase">
                  {pack.title}
                </span>
              </span>
              <span className="text-sm text-ink-muted">
                Planted flaw: {pack.flaw}
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      <section aria-labelledby="run-title" className="flex flex-col gap-4">
        <h2 id="run-title" className="eyebrow text-ink-muted">
          2. Run the Pre-screen
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            data-testid="run-prescreen"
            disabled={start.isPending || !packSlug}
            onClick={() => start.mutate(packSlug)}
            className="outline-box press min-h-11 rounded-sm bg-federal-blue px-5 py-2 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase disabled:cursor-wait disabled:opacity-70"
          >
            {start.isPending ? "Running…" : "Run Pre-screen"}
          </button>
          {start.isPending ? (
            <output className="text-ink-muted">
              Parsing each document, reading fields with the model and checking
              them against their sources. This takes about a minute.
            </output>
          ) : null}
        </div>
        {notice ? (
          <p
            role="alert"
            data-testid="run-notice"
            className="outline-box rounded-sm bg-limestone px-4 py-3"
          >
            {notice}
          </p>
        ) : null}
      </section>

      {view ? (
        <section
          aria-labelledby="findings-title"
          data-testid="findings-report"
          data-run-status={view.status}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="findings-title" className="eyebrow text-ink-muted">
              3. Findings
            </h2>
            <p className="text-sm text-ink-muted">
              Pre-screen date {view.prescreenDate} · model {view.model ?? "n/a"}
            </p>
          </div>

          {view.status === "failed" ? (
            <p className="outline-box rounded-sm bg-limestone px-4 py-3">
              This run failed: {view.error}
            </p>
          ) : (
            <p className="flex flex-wrap gap-3 font-mono text-sm uppercase">
              <span>{counts("pass")} pass</span>
              <span>· {counts("fail")} fail</span>
              <span>· {counts("needs_review")} need review</span>
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ol className="flex flex-col gap-3">
              {view.findings.map((finding) => {
                const style = OUTCOME_STYLES[finding.outcome];
                const isSelected =
                  selected?.requirementId === finding.requirementId;
                return (
                  <li key={finding.requirementId}>
                    <button
                      type="button"
                      data-testid={`finding-${finding.requirementId}`}
                      data-outcome={finding.outcome}
                      aria-pressed={isSelected}
                      onClick={() => selectFinding(finding)}
                      className={`outline-box flex w-full flex-col gap-2 rounded-sm p-3 text-left ${
                        isSelected
                          ? "bg-morning-haze shadow-hard-md"
                          : "bg-paper"
                      }`}
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
                      <span className="text-sm text-ink-muted">
                        {finding.reason}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="lg:sticky lg:top-4 lg:self-start">
              <p className="mb-3 text-sm text-ink-muted">
                {selected
                  ? "Boxes show exactly where each value was read."
                  : "Select a Finding to see its evidence on the document."}
              </p>
              <DocumentViewer
                documents={view.documents}
                activeKind={activeKind}
                onSelectKind={setActiveKind}
                finding={selected}
              />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
