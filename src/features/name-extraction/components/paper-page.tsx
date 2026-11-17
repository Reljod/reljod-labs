"use client";

import { memo } from "react";
import type { MarkStatus, PageMark, PreviewPage } from "../domain/contract";
import { segments } from "./marks";
import { cx } from "./ui";

export const MARK_CLASS: Record<MarkStatus, string> = {
  expected: "bg-morning-haze text-ink ring-1 ring-federal-blue/45 ring-inset",
  found: "bg-[#d5ead9] text-ink ring-1 ring-ivy/50 ring-inset",
  missed:
    "bg-seal-red/20 font-bold text-seal-red ring-2 ring-seal-red ring-inset",
  extra: "bg-brass/45 text-oak ring-1 ring-oak/40 ring-inset",
};

export const STATUS_WORD: Record<MarkStatus, string> = {
  expected: "a name Sieve should find",
  found: "found",
  missed: "missed",
  extra: "extra: not in the answer key",
};

export type Pulse = { name: string; nonce: number } | null;

/**
 * One page of the Document as paper: a running header, the page's text in
 * the document's own monospace layout, and its names highlighted. Shows
 * ruled placeholder lines until the text arrives.
 */
export const PaperPage = memo(function PaperPage({
  number,
  total,
  page,
  marks,
  pulse,
  label,
}: {
  number: number;
  total: number;
  page: PreviewPage | undefined;
  marks: PageMark[] | null;
  pulse: Pulse;
  /** A corner tag naming the side, in a comparison. */
  label?: string;
}) {
  return (
    <article
      aria-label={`Page ${number} of ${total}${label ? `, ${label}` : ""}`}
      className="sv-paper relative flex min-w-0 flex-col rounded-[3px] border border-ink/15 bg-paper shadow-[0_1px_0_rgb(20_33_61_/_0.06),0_10px_24px_-14px_rgb(20_33_61_/_0.35)]"
    >
      <header className="flex items-center justify-between gap-2 border-ink/10 border-b px-4 py-1.5 font-mono text-[0.6rem] tracking-[0.12em] text-ink-muted uppercase">
        <span className="truncate">{label ?? "Specimen"}</span>
        <span className="tabular-nums">
          {number} / {total}
        </span>
      </header>
      {page ? (
        <pre className="sv-paper-text px-4 py-3 font-mono text-ink">
          {segments(page.text, marks).map((part, index) =>
            part.mark ? (
              <mark
                key={`${index}-${pulse?.name === part.mark.name ? pulse.nonce : 0}`}
                title={`${part.mark.name} (${part.mark.type === "person" ? "person" : "organization"}) · ${STATUS_WORD[part.mark.status]}`}
                data-name={part.mark.name}
                className={cx(
                  "box-decoration-clone px-[3px] py-[1px]",
                  part.mark.type === "person"
                    ? "rounded-[5px]"
                    : "rounded-[1px]",
                  MARK_CLASS[part.mark.status],
                  pulse?.name === part.mark.name &&
                    (part.mark.status === "missed"
                      ? "sv-pulse-missed"
                      : "sv-pulse"),
                )}
              >
                {part.text}
              </mark>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional within a fixed text
              <span key={index}>{part.text}</span>
            ),
          )}
        </pre>
      ) : (
        <div
          aria-hidden="true"
          className="mx-4 my-4 aspect-[1/1.12] animate-pulse bg-[repeating-linear-gradient(180deg,rgb(20_33_61_/_0.07)_0,rgb(20_33_61_/_0.07)_6px,transparent_6px,transparent_17px)]"
        />
      )}
    </article>
  );
});
