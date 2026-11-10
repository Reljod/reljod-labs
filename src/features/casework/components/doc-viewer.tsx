"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { CHECKS } from "../domain/checks";
import { kindLabel } from "../domain/document-kinds";
import { documentPages } from "../server/actions";
import { OUTCOME_STYLE, RECOMMENDATION_STYLE } from "./glyphs";
import type { RunDocView, RunView } from "./run-reducer";
import { OwnershipView, PageWithEvidence } from "./stage";

type Pages = Awaited<ReturnType<typeof documentPages>>;

function Modal({
  children,
  onClose,
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-label={label}
        initial={{ y: 30, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="outline-box relative flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-sm bg-marble shadow-hard-lg"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** A Document's pages, with whatever the run read from it boxed on the page. */
export function DocViewer({
  documentId,
  run,
  onClose,
}: {
  documentId: string | null;
  run: RunView;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<Pages>(null);
  const [field, setField] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPages(null);
    setField(null);
    setPage(1);
    if (documentId) void documentPages(documentId).then(setPages);
  }, [documentId]);
  const read: RunDocView | undefined = run.documents.find(
    (document) => document.id === documentId,
  );
  const evidence = field ? read?.evidence[field] : undefined;
  const shownPage = evidence?.page ?? page;
  return (
    <AnimatePresence>
      {documentId ? (
        <Modal onClose={onClose} label="Document">
          <header className="flex items-center gap-3 border-ink border-b-2 bg-paper px-4 py-3">
            <p className="truncate font-mono text-sm font-bold uppercase">
              {pages?.name ?? "Opening…"}
            </p>
            {read?.kind ? (
              <span className="rounded-sm bg-ink px-1.5 py-0.5 font-mono text-[10px] text-paper uppercase">
                {kindLabel(read.kind)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto px-2 font-mono text-lg font-bold"
              aria-label="Close"
            >
              ×
            </button>
          </header>
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="cw-scroll outline-box min-h-0 overflow-auto rounded-sm bg-paper">
              {pages?.csv ? (
                <pre className="p-3 font-mono text-[11px] leading-snug whitespace-pre">
                  {pages.csv}
                </pre>
              ) : pages?.pages[shownPage - 1] ? (
                <PageWithEvidence
                  src={pages.pages[shownPage - 1]}
                  boxes={evidence?.boxes ?? []}
                  scanning={false}
                />
              ) : (
                <p className="p-6 font-mono text-xs text-stone">
                  Loading pages…
                </p>
              )}
            </div>
            <div className="cw-scroll flex min-h-0 flex-col gap-2 overflow-y-auto">
              {pages && pages.pages.length > 1 ? (
                <div className="flex gap-1">
                  {pages.pages.map((_, index) => (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: pages are positional
                      key={index}
                      type="button"
                      onClick={() => {
                        setField(null);
                        setPage(index + 1);
                      }}
                      className={`size-8 rounded-sm border-2 border-ink font-mono text-xs ${shownPage === index + 1 ? "bg-ink text-paper" : "bg-paper"}`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              ) : null}
              {read?.fields.length ? (
                <>
                  <p className="eyebrow text-ink-muted">
                    What was read · tap to locate
                  </p>
                  {read.fields.map((item) => {
                    const located = Boolean(read.evidence[item.name]);
                    return (
                      <button
                        key={item.name}
                        type="button"
                        disabled={!located}
                        onClick={() =>
                          setField(field === item.name ? null : item.name)
                        }
                        className={`rounded-sm border-2 px-3 py-1.5 text-left ${field === item.name ? "border-federal-blue bg-morning-haze" : "border-ink bg-paper"} disabled:cursor-default`}
                      >
                        <p className="font-mono text-[10px] tracking-[0.08em] text-ink-muted uppercase">
                          {item.name.replaceAll("_", " ")} {located ? "◎" : ""}
                        </p>
                        <p className="text-sm break-words">
                          {Array.isArray(item.value) &&
                          typeof item.value[0] === "object"
                            ? `${item.value.length} rows`
                            : Array.isArray(item.value)
                              ? (item.value as string[]).join(", ") || "None"
                              : typeof item.value === "boolean"
                                ? item.value
                                  ? "Yes"
                                  : "No"
                                : String(item.value ?? "") || "Not shown"}
                        </p>
                      </button>
                    );
                  })}
                </>
              ) : (
                <p className="text-sm text-ink-muted">
                  Not read in this run yet. Send it to the Specialist to extract
                  its fields.
                </p>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
    </AnimatePresence>
  );
}

/** Every check behind the decision, grouped by outcome. */
export function DecisionFile({
  open,
  run,
  onClose,
}: {
  open: boolean;
  run: RunView;
  onClose: () => void;
}) {
  const decision = run.decision;
  return (
    <AnimatePresence>
      {open && decision ? (
        <Modal onClose={onClose} label="Decision file">
          <header className="flex items-center gap-3 border-ink border-b-2 bg-paper px-4 py-3">
            <p className="font-mono text-sm font-bold uppercase">
              Decision file
            </p>
            <span
              className={`rounded-sm border-[3px] px-2 font-mono text-xs font-bold uppercase ${RECOMMENDATION_STYLE[decision.recommendation].tone}`}
            >
              {RECOMMENDATION_STYLE[decision.recommendation].stamp}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto px-2 font-mono text-lg font-bold"
              aria-label="Close"
            >
              ×
            </button>
          </header>
          <div className="cw-scroll grid min-h-0 gap-4 overflow-y-auto p-4 md:grid-cols-2">
            <section className="grid content-start gap-2">
              <h3 className="font-mono text-base leading-snug font-bold uppercase">
                {decision.headline}
              </h3>
              <p className="text-sm">{decision.summary}</p>
              <ol className="mt-1 grid gap-1 text-sm">
                {decision.nextSteps.map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="font-mono font-bold">{index + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
              {run.risk ? (
                <div className="mt-2 rounded-sm border-2 border-ink bg-paper p-3 text-sm">
                  <p className="font-mono text-xs font-bold uppercase">
                    {run.risk.rating} risk · score {run.risk.score}
                  </p>
                  <p className="text-ink-muted">
                    {run.risk.factors.join(", ") || "No risk factors"}
                  </p>
                </div>
              ) : null}
              {run.ownership ? (
                <div className="mt-2 rounded-sm border-2 border-ink bg-paper p-3">
                  <OwnershipView ownership={run.ownership} />
                </div>
              ) : null}
            </section>
            <section className="grid content-start gap-2">
              {(["fail", "review", "pass"] as const).flatMap((outcome) =>
                run.checks
                  .filter((check) => check.outcome === outcome)
                  .map((check) => (
                    <div
                      key={check.id}
                      className="flex gap-2 rounded-sm border-2 border-ink bg-paper p-2.5"
                    >
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-sm font-mono text-sm font-bold ${OUTCOME_STYLE[outcome].tone}`}
                      >
                        {OUTCOME_STYLE[outcome].mark}
                      </span>
                      <div>
                        <p className="font-mono text-xs font-bold uppercase">
                          {CHECKS[check.id].title}
                        </p>
                        <p className="text-sm text-ink-muted">{check.detail}</p>
                      </div>
                    </div>
                  )),
              )}
              {(run.hits ?? []).map((hit) => (
                <div
                  key={`${hit.reference}-${hit.screenedName}`}
                  className="rounded-sm border-2 border-ink bg-paper p-2.5 text-sm"
                >
                  <p className="font-mono text-xs font-bold uppercase">
                    {hit.hitName} · {hit.disposition?.replace("_", " ")}
                  </p>
                  <p className="text-ink-muted">{hit.dispositionReason}</p>
                </div>
              ))}
            </section>
          </div>
        </Modal>
      ) : null}
    </AnimatePresence>
  );
}
