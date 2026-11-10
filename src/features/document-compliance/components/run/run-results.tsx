"use client";

import { motion } from "motion/react";
import { useState } from "react";
import {
  formatMs,
  formatPercent,
  formatTokens,
  formatUsd,
  runTotals,
} from "../../metrics";
import { DOCUMENT_ORDER } from "../../scan-events";
import type { DocumentView, RunView } from "../../view";
import { DOCUMENT_LABELS } from "../labels";
import { DocumentInspector } from "./document-inspector";
import { FindingsReport } from "./findings-report";

type Tab = "findings" | "fields" | "raw" | "run";

const TABS: { id: Tab; label: string }[] = [
  { id: "findings", label: "Findings" },
  { id: "fields", label: "Fields" },
  { id: "raw", label: "Raw data" },
  { id: "run", label: "Run details" },
];

const ordered = (documents: DocumentView[]) =>
  [...documents].sort(
    (a, b) => DOCUMENT_ORDER.indexOf(a.kind) - DOCUMENT_ORDER.indexOf(b.kind),
  );

/** Mean confidence of a Document's Extracted fields; null when it has none. */
export function meanConfidence(document: DocumentView) {
  const values = document.fields.flatMap((field) =>
    field.confidence === null ? [] : [field.confidence],
  );
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function runDuration(view: RunView) {
  if (!view.completedAt) return null;
  return (
    new Date(view.completedAt).getTime() - new Date(view.createdAt).getTime()
  );
}

/** A finished run: its cost at a glance, then Findings, fields, raw data and details. */
export function RunResults({
  view,
  reduceMotion,
}: {
  view: RunView;
  reduceMotion: boolean;
}) {
  const [tab, setTab] = useState<Tab>("findings");
  return (
    <div className="flex flex-col gap-6">
      <RunSummary view={view} reduceMotion={reduceMotion} />
      <div
        role="tablist"
        aria-label="Run results"
        className="flex flex-wrap gap-2 border-ink border-b-2 pb-3"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`results-tab-${item.id}`}
            data-testid={`results-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`results-panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`outline-box eyebrow rounded-sm px-3 py-2 ${
              tab === item.id ? "bg-ink text-paper" : "bg-paper"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`results-panel-${tab}`}
        aria-labelledby={`results-tab-${tab}`}
      >
        {tab === "findings" ? (
          <FindingsReport view={view} reduceMotion={reduceMotion} />
        ) : tab === "fields" ? (
          <DocumentInspector view={view} mode="fields" />
        ) : tab === "raw" ? (
          <DocumentInspector view={view} mode="raw" />
        ) : (
          <RunDetails view={view} />
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string;
  detail?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="outline-box flex min-w-0 flex-col gap-0.5 rounded-sm bg-paper px-3 py-2"
    >
      <span className="eyebrow text-ink-muted">{label}</span>
      <span className="truncate font-mono text-base font-bold" title={value}>
        {value}
      </span>
      {detail ? (
        <span className="truncate font-mono text-[11px] text-ink-muted">
          {detail}
        </span>
      ) : null}
    </div>
  );
}

/** Model, cost, tokens, confidence and time: what the run took to produce. */
function RunSummary({
  view,
  reduceMotion,
}: {
  view: RunView;
  reduceMotion: boolean;
}) {
  const totals = runTotals(view.documents.map((document) => document.metrics));
  const confidences = view.documents.flatMap((document) =>
    document.fields.flatMap((field) =>
      field.confidence === null ? [] : [field.confidence],
    ),
  );
  const mean =
    confidences.length === 0
      ? null
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  const model = totals.models.join(", ") || view.model || "-";
  const measured = view.documents.some((document) => document.metrics);
  const provider = totals.providers.join(", ");

  return (
    <motion.section
      aria-label="Run summary"
      data-testid="run-summary"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      <Stat
        testId="stat-model"
        label="Model"
        value={model}
        detail={provider ? `via ${provider}` : "via Vercel AI Gateway"}
      />
      <Stat
        testId="stat-cost"
        label="Cost"
        value={formatUsd(totals.costUsd)}
        detail={
          totals.costUsd === null
            ? "not reported for this run"
            : "gateway price"
        }
      />
      <Stat
        testId="stat-tokens"
        label="Tokens"
        value={
          measured
            ? formatTokens(totals.inputTokens + totals.outputTokens)
            : "-"
        }
        detail={
          measured
            ? `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out${
                totals.reasoningTokens
                  ? ` · ${formatTokens(totals.reasoningTokens)} reasoning`
                  : ""
              }`
            : "not kept for this run"
        }
      />
      <Stat
        testId="stat-confidence"
        label="Mean confidence"
        value={formatPercent(mean)}
        detail={`${confidences.length} field${confidences.length === 1 ? "" : "s"} read`}
      />
      <Stat
        testId="stat-duration"
        label="Duration"
        value={formatMs(runDuration(view))}
        detail={`Pre-screen date ${view.prescreenDate}`}
      />
    </motion.section>
  );
}

function download(view: RunView) {
  // Signed page URLs expire and mean nothing outside this page.
  const record = {
    ...view,
    documents: view.documents.map(({ pages, ...document }) => ({
      ...document,
      pages: pages.map(({ page }) => ({ page })),
    })),
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `prescreen-run-${view.id}.json`;
  link.click();
  // Revoked after the click has been handled; some browsers read it late.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Where the run's time and money went, Document by Document. */
function RunDetails({ view }: { view: RunView }) {
  const documents = ordered(view.documents);
  const totals = runTotals(documents.map((document) => document.metrics));
  const measured = documents.some((document) => document.metrics);
  const rows: [string, string][] = [
    ["Run id", view.id],
    ["Status", view.status],
    ["Pack", view.packSlug],
    ["Requested model", view.model ?? "-"],
    ["Started", new Date(view.createdAt).toLocaleString("en-GB")],
    [
      "Completed",
      view.completedAt
        ? new Date(view.completedAt).toLocaleString("en-GB")
        : "-",
    ],
    ["Pre-screen date", view.prescreenDate],
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="run-details">
      <dl className="outline-box grid gap-x-6 gap-y-2 rounded-sm bg-paper p-4 font-mono text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-3">
            <dt className="w-36 shrink-0 text-ink-muted">{label}</dt>
            <dd className="min-w-0 break-all font-bold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="outline-box overflow-x-auto rounded-sm bg-paper">
        <table className="w-full min-w-[44rem] font-mono text-xs">
          <thead className="bg-ink text-left text-paper">
            <tr>
              {[
                "Document",
                "Parser",
                "Spans",
                "Fields",
                "Confidence",
                "Parse",
                "Read",
                "Tokens in / out",
                "Model",
                "Cost",
              ].map((heading) => (
                <th key={heading} className="px-3 py-2 font-bold uppercase">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => {
              const metrics = document.metrics;
              return (
                <tr
                  key={document.kind}
                  data-testid={`run-details-${document.kind}`}
                  className="border-ink/20 border-t"
                >
                  <td className="px-3 py-2 font-bold">
                    {DOCUMENT_LABELS[document.kind]}
                  </td>
                  <td className="px-3 py-2">{document.parser}</td>
                  <td className="px-3 py-2">{document.spans.length}</td>
                  <td className="px-3 py-2">{document.fields.length}</td>
                  <td className="px-3 py-2">
                    {formatPercent(meanConfidence(document))}
                  </td>
                  <td className="px-3 py-2">
                    {formatMs(metrics?.parseMs ?? null)}
                  </td>
                  <td className="px-3 py-2">
                    {formatMs(metrics?.readMs ?? null)}
                  </td>
                  <td className="px-3 py-2">
                    {formatTokens(metrics?.inputTokens ?? null)} /{" "}
                    {formatTokens(metrics?.outputTokens ?? null)}
                  </td>
                  <td className="px-3 py-2">
                    {metrics?.model ?? "-"}
                    {metrics?.provider ? (
                      <span className="text-ink-muted">
                        {" "}
                        · {metrics.provider}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-bold">
                    {formatUsd(metrics?.costUsd ?? null)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-ink border-t-2 font-bold">
              <td className="px-3 py-2" colSpan={7}>
                Total
              </td>
              <td className="px-3 py-2">
                {measured
                  ? `${formatTokens(totals.inputTokens)} / ${formatTokens(totals.outputTokens)}`
                  : "-"}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right">
                {formatUsd(totals.costUsd)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!measured ? (
        <p className="text-sm text-ink-muted">
          This run was saved before cost and timing were kept, so only its
          readings are shown.
        </p>
      ) : null}

      <button
        type="button"
        data-testid="download-run"
        onClick={() => download(view)}
        className="outline-box press self-start rounded-sm bg-paper px-3 py-2 font-mono text-xs font-bold uppercase"
      >
        ↓ Download run JSON
      </button>
    </div>
  );
}
