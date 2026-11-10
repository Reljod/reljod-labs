"use client";

import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { CHECKS } from "../domain/checks";
import { kindLabel } from "../domain/document-kinds";
import { documentPages } from "../server/actions";
import type { DocView } from "../view";
import type { RunCard } from "./chat-panel";
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink/50"
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-label={label}
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-sm border-2 border-ink bg-marble shadow-hard-lg"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

const FORMAT_WORDS: Record<DocView["sourceFormat"], string> = {
  pdf_digital: "Born-digital PDF (text layer)",
  pdf_scanned: "Scanned PDF (read by OCR)",
  image: "Photo (read by OCR)",
  csv: "Spreadsheet (CSV)",
};

const ZOOMS = [0.75, 1, 1.5, 2, 3];

function fieldText(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return typeof value[0] === "object"
      ? `${value.length} rows`
      : (value as string[]).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "") || "Not shown";
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-ink/10 border-b py-1.5 text-[13px] last:border-b-0">
      <dt className="w-20 shrink-0 font-mono text-[10px] tracking-[0.08em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * One Document, to look at and to inspect: its pages with zoom, what it is
 * and who it is about, and whatever the Run on the stage read from it, each
 * value boxed on the page when clicked.
 */
export function DocViewer({
  doc,
  run,
  picked,
  onPick,
  onClose,
}: {
  doc: DocView | null;
  run: RunView;
  picked: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const documentId = doc?.id ?? null;
  const [pages, setPages] = useState<Pages>(null);
  const [field, setField] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    setPages(null);
    setField(null);
    setPage(1);
    setZoom(1);
    if (documentId) void documentPages(documentId).then(setPages);
  }, [documentId]);
  const read: RunDocView | undefined = run.documents.find(
    (document) => document.id === documentId,
  );
  const evidence = field ? read?.evidence[field] : undefined;
  const count = pages?.pages.length ?? 0;
  const shownPage = Math.min(Math.max(1, evidence?.page ?? page), count || 1);
  const kind = read?.kind ?? doc?.kind ?? null;
  const step = (by: number) => {
    setField(null);
    setPage(Math.min(count, Math.max(1, shownPage + by)));
  };
  return (
    <AnimatePresence>
      {doc ? (
        <Modal onClose={onClose} label={`Document ${doc.name}`}>
          <header className="flex items-center gap-3 border-ink border-b-2 bg-ink px-4 py-2.5 text-paper">
            <p className="min-w-0 truncate font-mono text-sm font-bold">
              {doc.name}
            </p>
            {kind ? (
              <span className="shrink-0 rounded-sm bg-paper px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink uppercase">
                {kindLabel(kind)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onPick(doc.id)}
              disabled={picked}
              className="ml-auto shrink-0 rounded-sm border border-paper/50 px-2 py-1 font-mono text-[11px] font-bold tracking-[0.06em] uppercase hover:bg-paper/15 disabled:opacity-60"
            >
              {picked ? "In the message" : "+ Add to message"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 px-1 font-mono text-lg font-bold"
              aria-label="Close"
            >
              ×
            </button>
          </header>
          <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
            <div className="flex min-h-0 flex-col border-ink/20 md:border-r-2">
              {count > 0 ? (
                <div className="flex shrink-0 items-center gap-2 border-ink/15 border-b bg-paper px-3 py-1.5 font-mono text-[11px]">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    disabled={shownPage <= 1}
                    className="rounded-sm border border-ink/40 px-2 py-0.5 disabled:opacity-30"
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <span>
                    Page {shownPage} of {count}
                  </span>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    disabled={shownPage >= count}
                    className="rounded-sm border border-ink/40 px-2 py-0.5 disabled:opacity-30"
                    aria-label="Next page"
                  >
                    ›
                  </button>
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])
                      }
                      disabled={zoom === ZOOMS[0]}
                      className="rounded-sm border border-ink/40 px-2 py-0.5 disabled:opacity-30"
                      aria-label="Zoom out"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(1)}
                      className="w-12 rounded-sm border border-ink/40 py-0.5"
                      title="Fit the width"
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setZoom(
                          ZOOMS[
                            Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)
                          ],
                        )
                      }
                      disabled={zoom === ZOOMS.at(-1)}
                      className="rounded-sm border border-ink/40 px-2 py-0.5 disabled:opacity-30"
                      aria-label="Zoom in"
                    >
                      +
                    </button>
                  </span>
                </div>
              ) : null}
              <div className="cw-scroll min-h-0 flex-1 overflow-auto bg-limestone/50 p-3">
                {pages?.csv ? (
                  <CsvTable csv={pages.csv} />
                ) : pages?.pages[shownPage - 1] ? (
                  <div
                    className="mx-auto border border-ink/30 bg-paper shadow-hard-sm"
                    style={{ width: `${zoom * 100}%` }}
                  >
                    <PageWithEvidence
                      src={pages.pages[shownPage - 1]}
                      boxes={evidence?.boxes ?? []}
                      scanning={false}
                    />
                  </div>
                ) : (
                  <p className="cw-shimmer p-6 font-mono text-xs">
                    Opening the pages…
                  </p>
                )}
              </div>
            </div>
            <div className="cw-scroll flex min-h-0 flex-col gap-4 overflow-y-auto bg-marble/60 p-4">
              <section>
                <p className="eyebrow mb-1 text-ink-muted">Details</p>
                <dl className="rounded-sm border border-ink/25 bg-paper px-3 py-1">
                  <Detail label="Kind">
                    {kind ? kindLabel(kind) : "Not sorted yet"}
                  </Detail>
                  <Detail label="Format">
                    {FORMAT_WORDS[doc.sourceFormat]}
                  </Detail>
                  <Detail label="Pages">{doc.pageCount}</Detail>
                  <Detail label="Size">
                    {doc.sizeBytes > 1024 * 1024
                      ? `${(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`}
                  </Detail>
                  <Detail label="Filed in">
                    {doc.folder ?? "Your uploads"}
                  </Detail>
                  {doc.entities.length > 0 ? (
                    <Detail label="About">{doc.entities.join(", ")}</Detail>
                  ) : null}
                  {read?.gist ? (
                    <Detail label="Gist">{read.gist}</Detail>
                  ) : null}
                </dl>
              </section>
              <section className="grid gap-1.5">
                <p className="eyebrow text-ink-muted">
                  {read?.fields.length
                    ? "What the run read · click to find it on the page"
                    : "What the run read"}
                </p>
                {read?.fields.length ? (
                  read.fields.map((item) => {
                    const located = Boolean(read.evidence[item.name]);
                    return (
                      <button
                        key={item.name}
                        type="button"
                        disabled={!located}
                        onClick={() =>
                          setField(field === item.name ? null : item.name)
                        }
                        className={`rounded-sm border px-2.5 py-1.5 text-left transition-colors ${field === item.name ? "border-federal-blue bg-morning-haze" : "border-ink/25 bg-paper hover:border-ink"} disabled:cursor-default disabled:hover:border-ink/25`}
                      >
                        <p className="flex justify-between font-mono text-[10px] tracking-[0.08em] text-ink-muted uppercase">
                          <span>{item.name.replaceAll("_", " ")}</span>
                          {located ? (
                            <span className="text-federal-blue">Locate</span>
                          ) : null}
                        </p>
                        <p className="text-[13px] break-words">
                          {fieldText(item.value)}
                        </p>
                      </button>
                    );
                  })
                ) : (
                  <p className="rounded-sm border border-dashed border-ink/30 p-3 text-xs text-ink-muted">
                    Nothing yet. Add it to a message and ask the Specialist to
                    extract its fields, or run a review over it.
                  </p>
                )}
              </section>
            </div>
          </div>
        </Modal>
      ) : null}
    </AnimatePresence>
  );
}

/** A spreadsheet as a table, enough of it to judge what it is. */
function CsvTable({ csv }: { csv: string }) {
  const rows = csv
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 120)
    .map((line) => line.split(","));
  return (
    <table className="w-full border-collapse bg-paper font-mono text-[11px]">
      <tbody>
        {rows.map((cells, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <tr key={row} className={row === 0 ? "bg-ink text-paper" : ""}>
            {cells.map((cell, column) => (
              <td
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                key={column}
                className="border border-ink/20 px-2 py-1 whitespace-nowrap"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Every check behind the decision, grouped by outcome. */
export function DecisionFile({
  open,
  run,
  cost,
  onClose,
}: {
  open: boolean;
  run: RunView;
  /** What the Run cost, shown with the decision. */
  cost?: RunCard;
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
              {cost ? (
                <p className="mt-2 rounded-sm border border-ink/30 bg-paper px-3 py-2 font-mono text-xs">
                  This run cost{" "}
                  <span className="font-bold">${cost.costUsd.toFixed(4)}</span>{" "}
                  over {cost.calls} model call{cost.calls === 1 ? "" : "s"}.
                </p>
              ) : null}
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
