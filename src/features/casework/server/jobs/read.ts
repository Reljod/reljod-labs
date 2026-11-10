import "server-only";
import { Output, streamText } from "ai";
import { type ZodType, z } from "zod";
import type { Span } from "@/features/document-compliance/domain/types";
import { parseDocument } from "@/features/document-compliance/server/parsers";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  type FieldSpec,
  type FieldType,
} from "../../domain/document-kinds";
import type { Evidence, FieldValue, RunDocument } from "../../domain/run-state";
import { type CallCost, callOptions, trackCall } from "../llm";
import { download } from "../supabase";
import type { RunContext } from "./context";

/** The pages the model looks at, at most; long deeds are read from text beyond this. */
const MAX_PAGE_IMAGES = 4;
const MAX_SPANS = 900;

function scalar(type: FieldType): ZodType {
  switch (type) {
    case "money":
    case "number":
      return z.number().nullable();
    case "flag":
      return z.boolean();
    case "names":
      return z.array(z.string());
    default:
      return z.string();
  }
}

function fieldSchema(spec: FieldSpec): ZodType {
  if (spec.type === "list") {
    return z.array(
      z.object(
        Object.fromEntries(
          Object.entries(spec.item).map(([name, item]) => [
            name,
            scalar(item.type),
          ]),
        ),
      ),
    );
  }
  return scalar(spec.type);
}

/** The structured output for one kind: every field, plus where each was read. */
export function readSchema(kind: DocumentKind) {
  const fields = DOCUMENT_KINDS[kind].fields as Record<string, FieldSpec>;
  return z.object({
    corrections: z.array(z.object({ ref: z.string(), text: z.string() })),
    fields: z.object(
      Object.fromEntries(
        Object.entries(fields).map(([name, spec]) => [name, fieldSchema(spec)]),
      ),
    ),
    evidence: z.array(
      z.object({ field: z.string(), refs: z.array(z.string()) }),
    ),
  });
}

function describeFields(kind: DocumentKind) {
  const fields = DOCUMENT_KINDS[kind].fields as Record<string, FieldSpec>;
  return Object.entries(fields)
    .map(([name, spec]) =>
      spec.type === "list"
        ? `- ${name} (list): ${spec.hint}. Each item: ${Object.entries(
            spec.item,
          )
            .map(
              ([item, itemSpec]) =>
                `${item} (${itemSpec.type}: ${itemSpec.hint})`,
            )
            .join("; ")}`
        : `- ${name} (${spec.type}): ${spec.hint}`,
    )
    .join("\n");
}

const INSTRUCTIONS = `You read one document for the pension and onboarding desk of a Cayman Islands bank and trust company, and report exactly what is printed on it. You never judge the case; code does that from your readings.

You get the page images and the text the parser found, as Spans: "ref | page | text". Spreadsheets come as CSV text with no Spans.

Rules:
- Report every requested field. If a field is not printed, use "" for text and dates, null for numbers, false for flags and [] for names and lists.
- Dates: ISO YYYY-MM-DD. If a printed date is impossible (31 April), copy it as printed in ISO form anyway.
- Money: a plain number in CI$ (KYD). Convert US$ at 0.82 only when a field says so.
- Names: natural order "First Middle Last", even if printed "SURNAME, Given".
- Lists: one item per row, in the order printed.
- evidence: for each scalar field you filled, the Span refs it came from. Only refs from the list.
- corrections: only for Spans from OCR whose text differs from what the image shows: their ref and the text exactly as printed. Never merge or move Spans.`;

type Download = { data: Uint8Array; mediaType: string };

async function pagesOf(document: RunDocument): Promise<Download[]> {
  const paths = document.pagePaths?.length
    ? document.pagePaths
    : document.storagePath
      ? [document.storagePath]
      : [];
  return Promise.all(
    paths.map(async (path) => ({
      data: await download(path),
      mediaType: "image/jpeg",
    })),
  );
}

function evidenceFor(refs: string[], spans: Span[]): Evidence | undefined {
  const byRef = new Map(spans.map((span) => [span.ref, span]));
  const cited = refs.flatMap((ref) => {
    const span = byRef.get(ref);
    return span ? [span] : [];
  });
  const page = cited[0]?.page;
  if (!page) return undefined;
  return {
    page,
    boxes: cited.filter((span) => span.page === page).map((span) => span.box),
  };
}

export type ReadResult = {
  fields: Record<string, FieldValue>;
  evidence: Record<string, Evidence>;
  parser: "pdfjs" | "tesseract" | "csv" | "vision";
  spanCount: number;
  cost: CallCost;
};

/**
 * Reads one sorted Document: parse it inside the app (PDF text layer or OCR),
 * then have the model extract its kind's fields, streamed field by field.
 */
export async function readDocument(
  ctx: RunContext,
  document: RunDocument,
  kind: DocumentKind,
  onField: (name: string, value: FieldValue) => Promise<void>,
): Promise<ReadResult> {
  const started = Date.now();
  const settings = ctx.settings.read;
  let parser: ReadResult["parser"] = "csv";
  // Scans and photos go through Tesseract, as in document compliance, so every
  // field can be boxed on the page. CASEWORK_OCR=0 reads them by vision alone.
  const ocr = process.env.CASEWORK_OCR !== "0";
  let spans: Span[] = [];
  let pages: Download[] = [];
  let body: string;

  if (document.sourceFormat === "csv") {
    const csv = new TextDecoder().decode(
      await download(document.storagePath ?? ""),
    );
    body = `CSV:\n${csv}`;
  } else if (document.sourceFormat !== "pdf_digital" && !ocr) {
    pages = await pagesOf(document);
    parser = "vision";
    body = "No text layer: read the page images.";
  } else {
    pages = await pagesOf(document);
    const file =
      document.sourceFormat === "pdf_digital" && document.storagePath
        ? await download(document.storagePath)
        : (pages[0]?.data ?? new Uint8Array());
    const parsed = await parseDocument({
      file,
      sourceFormat: document.sourceFormat,
      pageImages: pages.map((page) => page.data),
    });
    parser = parsed.parser;
    spans = parsed.spans.slice(0, MAX_SPANS);
    body = `Spans (ref | page | text):\n${spans
      .map((span) =>
        span.confidence === null
          ? `${span.ref} | ${span.page} | ${span.text}`
          : `${span.ref} | ${span.page} | ${span.text} (ocr ${span.confidence.toFixed(2)})`,
      )
      .join("\n")}`;
  }

  const result = streamText({
    ...callOptions(settings),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: readSchema(kind) }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is a ${DOCUMENT_KINDS[kind].label.toLowerCase()} (${kind}), file "${document.name}".\n\nFields:\n${describeFields(kind)}\n\n${body}`,
          },
          ...pages.slice(0, MAX_PAGE_IMAGES).map((page) => ({
            type: "file" as const,
            mediaType: page.mediaType,
            data: page.data,
          })),
        ],
      },
    ],
  });

  // A field is complete once the model has moved on to the next one.
  const reported = new Set<string>();
  for await (const partial of result.partialOutputStream) {
    const keys = Object.keys(partial.fields ?? {});
    for (const key of keys.slice(0, -1)) {
      if (reported.has(key)) continue;
      reported.add(key);
      await onField(key, (partial.fields as Record<string, FieldValue>)[key]);
    }
  }
  const output = await result.output;
  const fields = output.fields as Record<string, FieldValue>;
  for (const [key, value] of Object.entries(fields)) {
    if (!reported.has(key)) await onField(key, value);
  }

  const evidence: Record<string, Evidence> = {};
  for (const item of output.evidence) {
    const found = evidenceFor(item.refs, spans);
    if (found) evidence[item.field] = found;
  }

  const cost = await trackCall({
    purpose: "read",
    model: settings.model,
    usage: await result.usage,
    providerMetadata: await result.providerMetadata,
    started,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
  });
  return { fields, evidence, parser, spanCount: spans.length, cost };
}
