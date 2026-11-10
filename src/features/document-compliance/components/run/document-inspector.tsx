"use client";

import { useState } from "react";
import type { DocumentKind } from "../../domain/types";
import { formatPercent } from "../../metrics";
import { DOCUMENT_ORDER } from "../../scan-events";
import type { DocumentView, RunView } from "../../view";
import { ConfidenceBar, LOW_CONFIDENCE } from "../confidence";
import { CHECK_STYLES, DOCUMENT_LABELS, FIELD_LABELS } from "../labels";

type RawView = "model" | "spans" | "record";

const RAW_VIEWS: { id: RawView; label: string }[] = [
  { id: "model", label: "Model output" },
  { id: "spans", label: "Parser spans" },
  { id: "record", label: "Stored record" },
];

/**
 * Everything read from each Document: its Extracted fields with confidence and
 * Field checks, or the raw data behind them (the model's answer, the parser's
 * Spans and the stored record).
 */
export function DocumentInspector({
  view,
  mode,
}: {
  view: RunView;
  mode: "fields" | "raw";
}) {
  const documents = [...view.documents].sort(
    (a, b) => DOCUMENT_ORDER.indexOf(a.kind) - DOCUMENT_ORDER.indexOf(b.kind),
  );
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const document =
    documents.find((item) => item.kind === kind) ?? documents[0] ?? null;
  if (!document) {
    return <p className="text-sm text-ink-muted">No Documents were saved.</p>;
  }

  return (
    <section
      data-testid={`inspector-${mode}`}
      className="outline-box rounded-sm bg-paper"
    >
      <div
        role="tablist"
        aria-label="Documents"
        className="flex flex-wrap border-ink border-b-2"
      >
        {documents.map((item) => (
          <button
            key={item.kind}
            type="button"
            role="tab"
            aria-selected={item.kind === document.kind}
            onClick={() => setKind(item.kind)}
            className={`eyebrow border-ink border-r-2 px-4 py-3 ${
              item.kind === document.kind ? "bg-ink text-paper" : "bg-paper"
            }`}
          >
            {DOCUMENT_LABELS[item.kind]}
          </button>
        ))}
      </div>
      {mode === "fields" ? (
        <FieldsTable document={document} />
      ) : (
        <RawData document={document} />
      )}
    </section>
  );
}

function FieldsTable({ document }: { document: DocumentView }) {
  const { judgments } = document;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="text-left">
            <tr className="border-ink border-b-2">
              {["Field", "Value", "Confidence", "In source", "Field check"].map(
                (heading) => (
                  <th key={heading} className="eyebrow px-2 py-2">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {document.fields.map((field) => {
              const check = document.checks.find(
                (item) => item.fieldName === field.name,
              );
              const style = CHECK_STYLES[check?.outcome ?? "read"];
              return (
                <tr
                  key={field.name}
                  data-testid="inspector-field"
                  data-field-name={field.name}
                  className="border-ink/15 border-b align-top"
                >
                  <td className="px-2 py-2 font-mono text-xs text-ink-muted">
                    {FIELD_LABELS[field.name]}
                    <div className="mt-1 text-[10px]">
                      [{field.spanRefs.join(", ")}]
                    </div>
                  </td>
                  <td className="px-2 py-2 font-mono font-bold break-words">
                    {field.value}
                  </td>
                  <td className="w-40 px-2 py-2">
                    {field.confidence === null ? (
                      "-"
                    ) : (
                      <ConfidenceBar value={field.confidence} />
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    <span
                      className={field.verified ? "text-ivy" : "text-seal-red"}
                    >
                      {field.verified ? "✓ found" : "✕ not found"}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {check ? (
                      <span className="flex items-start gap-2">
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-[2px] font-mono font-bold ${style.chip}`}
                          title={style.label}
                        >
                          {style.mark}
                        </span>
                        <span>
                          {check.note}
                          {check.expected &&
                          (check.outcome === "fail" ||
                            check.outcome === "needs_review") ? (
                            <span className="block font-mono text-ink-muted">
                              expected {check.expected}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {document.fields.length === 0 ? (
        <p className="text-sm text-ink-muted">No fields were read.</p>
      ) : null}
      {document.fields.some(
        (field) =>
          field.confidence !== null && field.confidence < LOW_CONFIDENCE,
      ) ? (
        <p className="text-xs text-ink-muted">
          Confidence below {formatPercent(LOW_CONFIDENCE)} is the model's own
          doubt about a reading; any Finding resting on it goes to Needs review.
        </p>
      ) : null}

      <dl className="grid gap-2 rounded-sm bg-marble p-3 font-mono text-xs sm:grid-cols-3">
        <Judgment label="Legible" value={judgments.legible ? "yes" : "no"} />
        <Judgment
          label="Tampering suspected"
          value={
            judgments.tamperingSuspected
              ? `yes · ${judgments.tamperingSpanRefs.join(", ") || "no spans"}`
              : "no"
          }
        />
        <Judgment
          label="Signature"
          value={
            judgments.signaturePresent === null
              ? "n/a"
              : judgments.signaturePresent
                ? "present"
                : "missing"
          }
        />
        {judgments.notes ? (
          <div className="sm:col-span-3">
            <dt className="text-ink-muted">Model notes</dt>
            <dd>{judgments.notes}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function Judgment({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

function RawData({ document }: { document: DocumentView }) {
  const [raw, setRaw] = useState<RawView>("model");
  const [copied, setCopied] = useState(false);
  const { pages: _pages, ...record } = document;
  const json =
    raw === "model" ? document.raw : raw === "spans" ? document.spans : record;
  const text = json === null ? null : JSON.stringify(json, null, 2);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {RAW_VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`raw-${item.id}`}
            aria-pressed={raw === item.id}
            onClick={() => {
              setRaw(item.id);
              setCopied(false);
            }}
            className={`rounded-sm border border-ink px-2 py-1 font-mono text-xs font-bold uppercase ${
              raw === item.id ? "bg-federal-blue text-paper" : "bg-paper"
            }`}
          >
            {item.label}
          </button>
        ))}
        {text ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
              });
            }}
            className="ml-auto rounded-sm border border-ink bg-paper px-2 py-1 font-mono text-xs font-bold uppercase"
          >
            {copied ? "✓ Copied" : "Copy JSON"}
          </button>
        ) : null}
      </div>
      {raw === "spans" ? (
        <SpansTable document={document} />
      ) : text ? (
        <pre
          data-testid="raw-json"
          className="max-h-[32rem] overflow-auto rounded-sm bg-ink p-3 font-mono text-[11px] leading-relaxed text-paper"
        >
          {text}
        </pre>
      ) : (
        <p className="text-sm text-ink-muted">
          The model's raw answer was not kept for this run; it predates raw data
          being saved.
        </p>
      )}
    </div>
  );
}

function SpansTable({ document }: { document: DocumentView }) {
  const cited = new Set(document.fields.flatMap((field) => field.spanRefs));
  return (
    <div className="max-h-[32rem] overflow-auto rounded-sm border border-ink">
      <table className="w-full min-w-[36rem] font-mono text-[11px]">
        <thead className="sticky top-0 bg-ink text-left text-paper">
          <tr>
            {["Ref", "Page", "Text", "OCR conf.", "Box (x0 y0 x1 y1)"].map(
              (heading) => (
                <th key={heading} className="px-2 py-1.5 uppercase">
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {document.spans.map((span) => (
            <tr
              key={span.ref}
              className={`border-ink/15 border-t ${cited.has(span.ref) ? "bg-morning-haze" : ""}`}
            >
              <td className="px-2 py-1 font-bold">{span.ref}</td>
              <td className="px-2 py-1">{span.page}</td>
              <td className="px-2 py-1 break-all">{span.text}</td>
              <td className="px-2 py-1">{formatPercent(span.confidence)}</td>
              <td className="px-2 py-1 whitespace-nowrap text-ink-muted">
                {[span.box.x0, span.box.y0, span.box.x1, span.box.y1]
                  .map((value) => value.toFixed(3))
                  .join(" ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-ink/15 border-t px-2 py-1.5 text-[11px] text-ink-muted">
        {document.spans.length} spans from {document.parser}; highlighted rows
        are cited by a field.
      </p>
    </div>
  );
}
