"use client";

import { useMemo } from "react";
import type {
  DocumentBlock,
  DocumentMeta,
  DocumentSection,
  StepBlock,
  TableBlock,
} from "../domain/document";
import { documentDate, documentSections } from "../domain/document";
import type { FrameUrls } from "../domain/frames";
import { frameKey } from "../domain/frames";
import type { Process } from "../domain/process";

/*
 * The Workflow document on the page: the same sections the DOCX is written
 * from (`documentSections`), laid out as a sheet of paper. Figures are
 * numbered the same way as in the DOCX, counting only steps with a Frame.
 */

type Props = {
  process: Process;
  meta: DocumentMeta;
  frames?: FrameUrls;
  /** Jumps the Recording to a step's time; without it the times are plain text. */
  onSeek?(seconds: number): void;
  className?: string;
};

export function DocumentView({
  process,
  meta,
  frames,
  onSeek,
  className,
}: Props) {
  const sections = useMemo(
    () => documentSections(process, meta),
    [process, meta],
  );
  const figures = useMemo(() => {
    const numbers = new Map<string, { number: number; url: string }>();
    for (const section of sections) {
      for (const block of section.blocks) {
        if (block.kind !== "step" || block.at === null) continue;
        const url = frames?.[frameKey(block.at)];
        if (url) numbers.set(block.id, { number: numbers.size + 1, url });
      }
    }
    return numbers;
  }, [sections, frames]);
  const [cover, ...rest] = sections;
  const title = cover?.heading ?? process.title;

  return (
    <article
      aria-label={`Workflow document: ${title}`}
      className={`mx-auto w-full max-w-[52rem] rounded-sm border-2 border-ink bg-paper text-ink shadow-hard-md ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-limestone px-5 py-2 text-[11px] text-ink-muted sm:px-12">
        <span className="font-semibold text-ink">{title}</span>
        <span>
          Workflow document ·{" "}
          {meta.status === "approved" ? "Approved" : "Draft"}
        </span>
      </div>

      <div className="px-5 py-8 sm:px-12 sm:py-10">
        {cover ? <Cover section={cover} /> : null}
        {rest.map((section) => (
          <Section
            key={section.id}
            section={section}
            figures={figures}
            onSeek={onSeek}
          />
        ))}
      </div>

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-limestone px-5 py-2 text-[11px] text-ink-muted sm:px-12">
        <span>
          {meta.recordingName} · {documentDate(meta.generatedAt)} · Version{" "}
          {meta.version ?? "0.1"}
        </span>
        <span>Preview of the DOCX</span>
      </div>
    </article>
  );
}

function Cover({ section }: { section: DocumentSection }) {
  return (
    <header>
      {section.eyebrow ? (
        <p className="eyebrow text-federal-blue">{section.eyebrow}</p>
      ) : null}
      <h2 className="mt-2 text-3xl leading-tight font-bold text-balance sm:text-4xl">
        {section.heading}
      </h2>
      <div className="mt-5 space-y-4">
        {section.blocks.map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are fixed per render and never reorder
          <Block key={index} block={block} />
        ))}
      </div>
    </header>
  );
}

function Section({
  section,
  figures,
  onSeek,
}: {
  section: DocumentSection;
  figures: Map<string, { number: number; url: string }>;
  onSeek?(seconds: number): void;
}) {
  const id = `doc-${section.id}`;
  return (
    <section aria-labelledby={id} className="mt-10">
      <h3
        id={id}
        className="border-b border-limestone pb-1.5 text-xl font-bold text-federal-blue"
      >
        {section.number !== null ? `${section.number}. ` : ""}
        {section.heading}
      </h3>
      <div className="mt-4 space-y-4">
        {section.blocks.map((block, index) =>
          block.kind === "step" ? (
            <Step
              key={block.id}
              step={block}
              figure={figures.get(block.id)}
              onSeek={onSeek}
            />
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are fixed per render and never reorder
            <Block key={index} block={block} />
          ),
        )}
      </div>
    </section>
  );
}

function Block({ block }: { block: DocumentBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p
          className={`max-w-[70ch] text-[15px] leading-relaxed ${block.muted ? "text-ink-muted" : ""}`}
        >
          {block.text}
        </p>
      );
    case "subheading":
      return <h4 className="pt-1 text-base font-bold">{block.text}</h4>;
    case "bullets":
      return (
        <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed marker:text-federal-blue">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items may repeat; order is fixed
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case "numbered":
      return (
        <ol className="list-decimal space-y-1 pl-6 text-[15px] leading-relaxed">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items may repeat; order is fixed
            <li key={index}>{item}</li>
          ))}
        </ol>
      );
    case "keyValue":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="w-[30%] border border-stone bg-marble px-3 py-1.5 text-left align-top font-semibold"
                  >
                    {row.key}
                  </th>
                  <td className="border border-stone px-3 py-1.5 align-top">
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "table":
      return <DataTable block={block} />;
    case "callout":
      return (
        <p
          className={`border-l-4 px-4 py-2.5 text-sm leading-relaxed ${
            block.tone === "warning"
              ? "border-seal-red bg-seal-red/8"
              : "border-brass bg-brass/15"
          }`}
        >
          <strong
            className={block.tone === "warning" ? "text-seal-red" : "text-ink"}
          >
            {block.title}:
          </strong>{" "}
          {block.text}
        </p>
      );
    case "step":
      return null;
  }
}

function DataTable({
  block,
  caption,
}: {
  block: TableBlock;
  caption?: React.ReactNode;
}) {
  const total = block.widths.reduce((sum, value) => sum + value, 0) || 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        {caption ? (
          <caption className="pb-2 text-left text-sm font-bold">
            {caption}
          </caption>
        ) : null}
        <colgroup>
          {block.columns.map((column, index) => (
            <col
              key={column}
              style={{
                width: `${((block.widths[index] ?? 0) / total) * 100}%`,
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {block.columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="border border-stone bg-limestone px-3 py-1.5 text-left font-semibold"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are fixed per render
            <tr key={rowIndex}>
              {block.columns.map((column, index) => (
                <td
                  key={column}
                  className="border border-stone px-3 py-1.5 align-top"
                >
                  {row[index]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step({
  step,
  figure,
  onSeek,
}: {
  step: StepBlock;
  figure?: { number: number; url: string };
  onSeek?(seconds: number): void;
}) {
  const id = `doc-step-${step.id}`;
  const at = step.at;
  return (
    <section
      aria-labelledby={id}
      className="mt-6 border-t border-limestone pt-5 first:mt-0"
    >
      <h4 id={id} className="text-lg leading-snug font-bold">
        <span className="text-federal-blue">Step {step.number}:</span>{" "}
        {step.title}
      </h4>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-muted">
        <span>
          Who{" "}
          <strong className="font-semibold text-ink">
            {step.actor || "Not named"}
          </strong>
        </span>
        {step.system ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              Where{" "}
              <strong className="font-semibold text-ink">{step.system}</strong>
            </span>
          </>
        ) : null}
        {step.time && at !== null ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              In the recording{" "}
              {onSeek ? (
                <button
                  type="button"
                  onClick={() => onSeek(at)}
                  aria-label={`Play the recording from ${step.time}`}
                  className="rounded-sm border border-ink/40 px-1.5 py-0.5 font-mono font-semibold text-federal-blue hover:border-ink hover:bg-morning-haze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
                >
                  ▶ {step.time}
                </button>
              ) : (
                <strong className="font-mono font-semibold text-ink">
                  {step.time}
                </strong>
              )}
            </span>
          </>
        ) : null}
      </p>

      <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed">
        {step.action}
      </p>

      {figure ? (
        <figure className="mt-4">
          {/* biome-ignore lint/performance/noImgElement: Frames are object URLs captured in the browser */}
          <img
            src={figure.url}
            alt={`Screen at ${step.time} in the recording, step ${step.number}: ${step.title}`}
            className="block h-auto max-h-[22rem] w-auto max-w-full border border-stone"
          />
          <figcaption className="mt-1.5 text-xs text-ink-muted italic">
            Figure {figure.number}. Step {step.number} at {step.time} in the
            recording
          </figcaption>
        </figure>
      ) : null}

      {step.details.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed marker:text-federal-blue">
          {step.details.map((detail, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: details may repeat; order is fixed
            <li key={index}>{detail}</li>
          ))}
        </ul>
      ) : null}

      {step.warning ? (
        <p className="mt-3 border-l-4 border-seal-red bg-seal-red/8 px-4 py-2.5 text-sm leading-relaxed">
          <strong className="text-seal-red">Watch out:</strong> {step.warning}
        </p>
      ) : null}

      {step.decision ? (
        <div className="mt-4">
          <DataTable
            caption={
              <>
                <span className="text-federal-blue">Decision:</span>{" "}
                {step.decision.question}
              </>
            }
            block={{
              kind: "table",
              columns: ["If", "Then"],
              widths: [0.4, 0.6],
              rows: step.decision.branches.map((branch) => [
                branch.when,
                branch.then,
              ]),
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
