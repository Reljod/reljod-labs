"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SourcePreviewResponse } from "../../domain/api";
import { AGENT_TEXT_CHARS } from "../../domain/knowledge";
import {
  parseCsv,
  sheetTables,
  tableOf,
} from "../../domain/knowledge/csv-table";
import { api, formatBytes, keys, messageOf } from "../api";
import { Button, cx, ErrorNote, Loading } from "../ui";

export type PreviewMode = "original" | "text";

/** What the Agent reads of an unfiled Source in one go (`read_source`). */
const AGENT_READS_CHARS = AGENT_TEXT_CHARS;
/** Pages and rows drawn, so a very large file stays a preview. */
const MAX_PDF_PAGES = 40;
const MAX_TABLE_ROWS = 500;

const number = (value: number) => value.toLocaleString("en-US");

/**
 * A Source read raw, in two views: the original as stored (a PDF drawn page
 * by page, a CSV or workbook as a table with a sticky header, Markdown and
 * text as text) and the exact text the Agent reads. Works for a Source that
 * is attached and not filed. The signed link to the file lasts five minutes
 * and is fetched afresh each time the view opens (the read is audited).
 */
export function SourcePreview({
  sourceId,
  mode,
  onMode,
}: {
  sourceId: string;
  mode: PreviewMode;
  onMode: (mode: PreviewMode) => void;
}) {
  const preview = useQuery({
    queryKey: keys.sourcePreview(sourceId),
    queryFn: () => api.sources.preview(sourceId),
    // The link lasts five minutes; keep this fetch for four, and do not
    // re-audit a read on every focus.
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Preview view"
        className="inline-flex rounded-sm outline-box bg-paper p-0.5"
      >
        {(
          [
            ["original", "Original"],
            ["text", "Raw text"],
          ] as const
        ).map(([id, label]) => (
          // biome-ignore lint/a11y/useSemanticElements: a two-way switch drawn as buttons
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => onMode(id)}
            className={cx(
              "h-7 rounded-sm px-3 text-xs font-medium",
              mode === id
                ? "bg-ink text-paper"
                : "text-ink-muted hover:bg-marble hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {preview.isPending ? (
        <Loading rows={4} />
      ) : preview.isError ? (
        <ErrorNote onRetry={() => void preview.refetch()}>
          {messageOf(preview.error)}
        </ErrorNote>
      ) : mode === "text" ? (
        <RawText data={preview.data} />
      ) : (
        <Original data={preview.data} />
      )}
    </div>
  );
}

// Raw text -------------------------------------------------------------------------

function RawText({ data }: { data: SourcePreviewResponse }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (data.text === null) {
    return (
      <p className="rounded-sm outline-box bg-marble/60 p-3 text-sm text-ink-muted">
        {data.textError ?? "No text could be read from this Source."}
      </p>
    );
  }
  const text = data.text;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2_500);
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-xs text-ink-muted">
          <span className="font-mono">{number(data.textChars)} characters</span>
          {data.truncated ? `, the first ${number(text.length)} shown` : ""}
          {data.source.status === "pending" &&
          data.textChars > AGENT_READS_CHARS
            ? `. The Agent reads the first ${number(AGENT_READS_CHARS)} of an unfiled Source.`
            : ". Exactly what the Agent reads."}
        </p>
        <Button size="sm" onClick={() => void copy()}>
          {copied === "ok" ? "Copied" : "Copy text"}
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied === "ok"
            ? "Copied to the clipboard."
            : copied === "failed"
              ? "Could not copy."
              : ""}
        </span>
        {copied === "failed" ? (
          <span className="text-xs text-seal-red">
            Copy is not available here. Select the text instead.
          </span>
        ) : null}
      </div>
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
        tabIndex={0}
        className="hx-scroll max-h-[28rem] overflow-x-auto rounded-sm outline-box bg-paper p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-federal-blue"
      >
        {text}
      </pre>
    </div>
  );
}

// Original -------------------------------------------------------------------------

function OriginalLink({ data }: { data: SourcePreviewResponse }) {
  if (!data.file) return null;
  return (
    <a
      href={data.file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-federal-blue underline underline-offset-2"
    >
      Open the file in a new tab (link lasts 5 minutes)
    </a>
  );
}

function Original({ data }: { data: SourcePreviewResponse }) {
  const file = data.file;
  if (!file) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-ink-muted">
          This Source has no file (
          {data.source.isSeed
            ? "it ships with the Workspace"
            : "it was added as text"}
          ), so its text is shown.
        </p>
        <PlainText text={data.text} error={data.textError} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted">
          {file.name} · {formatBytes(data.source.bytes)}
        </p>
        <OriginalLink data={data} />
      </div>
      {file.format === "pdf" ? (
        <PdfPages url={file.url} />
      ) : file.format === "csv" ? (
        <TextTable text={data.text} error={data.textError} />
      ) : file.format === "xlsx" ? (
        <Sheets text={data.text} error={data.textError} />
      ) : file.format === "docx" ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            A Word file cannot be drawn here. Its text is shown; open the file
            to see the original.
          </p>
          <PlainText text={data.text} error={data.textError} />
        </div>
      ) : (
        <PlainText text={data.text} error={data.textError} />
      )}
    </div>
  );
}

function PlainText({
  text,
  error,
}: {
  text: string | null;
  error: string | null;
}) {
  if (text === null) {
    return (
      <p className="rounded-sm outline-box bg-marble/60 p-3 text-sm text-ink-muted">
        {error ?? "No text could be read from this Source."}
      </p>
    );
  }
  return (
    <pre
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
      tabIndex={0}
      className="hx-scroll max-h-[32rem] overflow-x-auto rounded-sm outline-box bg-paper p-3 text-sm leading-relaxed break-words whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-federal-blue"
    >
      {text}
    </pre>
  );
}

// Tables ---------------------------------------------------------------------------

function Table({ rows, caption }: { rows: string[][]; caption?: string }) {
  const { notes, head, body, columns } = tableOf(rows);
  if (columns === 0) {
    return <p className="text-sm text-ink-muted">This table is empty.</p>;
  }
  const shown = body.slice(0, MAX_TABLE_ROWS);
  const across = Array.from({ length: columns }, (_, index) => index);
  return (
    <div className="space-y-1">
      {notes.length > 0 ? (
        <div className="space-y-0.5 font-mono text-xs text-ink-muted">
          {notes.map((note, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a note is its line
            <p key={index}>{note}</p>
          ))}
        </div>
      ) : null}
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
        tabIndex={0}
        aria-label={caption ?? "Table"}
        className="hx-scroll max-h-[28rem] overflow-auto rounded-sm outline-box bg-paper focus-visible:outline-2 focus-visible:outline-federal-blue"
      >
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              {across.map((index) => (
                <th
                  key={index}
                  scope="col"
                  className="sticky top-0 z-10 border-ink border-b-2 bg-marble px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                >
                  {head[index] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity but their place
              <tr key={rowIndex} className="odd:bg-marble/40">
                {across.map((columnIndex) => (
                  <td
                    key={columnIndex}
                    className="border-ink/15 border-b px-2 py-1 align-top font-mono whitespace-nowrap"
                  >
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-ink-muted">
        {number(body.length)} row{body.length === 1 ? "" : "s"}
        {body.length > shown.length
          ? `, the first ${number(shown.length)} shown`
          : ""}
        .
      </p>
    </div>
  );
}

function TextTable({
  text,
  error,
}: {
  text: string | null;
  error: string | null;
}) {
  const rows = useMemo(() => (text === null ? null : parseCsv(text)), [text]);
  if (rows === null) return <PlainText text={null} error={error} />;
  return <Table rows={rows} caption="CSV file as a table" />;
}

function Sheets({
  text,
  error,
}: {
  text: string | null;
  error: string | null;
}) {
  const sheets = useMemo(
    () => (text === null ? null : sheetTables(text)),
    [text],
  );
  const [picked, setPicked] = useState(0);
  if (sheets === null) return <PlainText text={null} error={error} />;
  const sheet = sheets[Math.min(picked, sheets.length - 1)];
  return (
    <div className="space-y-2">
      {sheets.length > 1 ? (
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex flex-wrap gap-1"
        >
          {sheets.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === picked}
              onClick={() => setPicked(index)}
              className={cx(
                "outline-box press eyebrow rounded-sm px-2 py-1 text-[0.7rem] shadow-hard-sm",
                index === picked
                  ? "bg-ink text-paper"
                  : "bg-paper hover:bg-morning-haze",
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      {sheet ? (
        <Table rows={sheet.rows} caption={`Sheet ${sheet.name}`} />
      ) : null}
    </div>
  );
}

// PDF ------------------------------------------------------------------------------

/**
 * The PDF drawn by pdf.js from the signed URL's bytes. An iframe is not used:
 * Storage serves files with a sandboxing Content-Security-Policy, which keeps
 * a browser's PDF viewer from opening them.
 */
function PdfPages({ url }: { url: string }) {
  const host = useRef<HTMLElement>(null);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; pages: number }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const element = host.current;
    setState({ kind: "loading" });
    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Storage said ${response.status}.`);
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        // The worker is bundled with the app, so nothing is fetched from a CDN.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled || !element) return;
        element.replaceChildren();
        const width = Math.min(element.clientWidth || 720, 900);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const count = Math.min(pdf.numPages, MAX_PDF_PAGES);
        for (let number = 1; number <= count; number++) {
          const page = await pdf.getPage(number);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: (width / base.width) * ratio,
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${Math.ceil(viewport.width / ratio)}px`;
          canvas.style.maxWidth = "100%";
          canvas.style.height = "auto";
          canvas.className =
            "mx-auto mb-3 block outline-box bg-paper shadow-hard-sm";
          canvas.setAttribute("role", "img");
          canvas.setAttribute(
            "aria-label",
            `Page ${number} of ${pdf.numPages}`,
          );
          const context = canvas.getContext("2d");
          if (!context) continue;
          element.append(canvas);
          await page.render({ canvas, canvasContext: context, viewport })
            .promise;
        }
        await pdf.cleanup();
        if (!cancelled) setState({ kind: "ready", pages: pdf.numPages });
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              error instanceof Error ? error.message : "The PDF did not load.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      element?.replaceChildren();
    };
  }, [url]);

  return (
    <div className="space-y-1.5">
      {state.kind === "loading" ? (
        <p className="text-xs text-ink-muted" aria-live="polite">
          Drawing the PDF…
        </p>
      ) : null}
      {state.kind === "error" ? (
        <ErrorNote>
          The PDF could not be drawn here ({state.message}) Open the file in a
          new tab instead, or read its raw text.
        </ErrorNote>
      ) : null}
      <section
        ref={host}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
        tabIndex={0}
        aria-label="PDF pages"
        className="hx-scroll max-h-[34rem] overflow-y-auto rounded-sm outline-box bg-marble/60 p-3 focus-visible:outline-2 focus-visible:outline-federal-blue"
      />
      {state.kind === "ready" && state.pages > MAX_PDF_PAGES ? (
        <p className="text-xs text-ink-muted">
          The first {MAX_PDF_PAGES} of {state.pages} pages are shown.
        </p>
      ) : null}
    </div>
  );
}
