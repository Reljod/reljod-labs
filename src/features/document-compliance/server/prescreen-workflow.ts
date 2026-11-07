import { getStepMetadata, getWritable } from "workflow";
import { evaluate } from "../domain/evaluate";
import { fieldChecks } from "../domain/field-checks";
import { individualOnboarding } from "../domain/rulebook";
import type { DocumentKind, ExtractedDocument, Span } from "../domain/types";
import { verifyReading } from "../domain/verify";
import { findPack, type Pack, type PackDocument, storagePath } from "../packs";
import type { ScanEvent } from "../scan-events";
import { findingViews } from "../view";
import { extractDocument } from "./extract";
import { type ParsedDocument, parseDocument } from "./parser-client";
import {
  failRun,
  type SavedDocument,
  saveDocument,
  saveFindings,
  setRunStatus,
} from "./repository";
import { signedUrl } from "./supabase";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

async function emit(event: DistributiveOmit<ScanEvent, "at">) {
  const writer = getWritable<ScanEvent>().getWriter();
  try {
    await writer.write({ ...event, at: Date.now() } as ScanEvent);
  } finally {
    writer.releaseLock();
  }
}

function packAndDocument(packSlug: string, kind: DocumentKind) {
  const pack = findPack(packSlug);
  const document = pack?.documents.find((item) => item.kind === kind);
  if (!pack || !document) throw new Error(`No ${kind} in pack ${packSlug}`);
  return { pack, document };
}

/**
 * Runs one stage of one Document inside a step, streaming its start (or retry),
 * finish and failure so the run page can show them as they happen.
 */
async function staged<T>(
  kind: DocumentKind,
  stage: "parse" | "read",
  work: () => Promise<{ value: T; detail: string }>,
): Promise<T> {
  const { attempt } = getStepMetadata();
  const started = Date.now();
  await emit({
    type: "stage",
    kind,
    stage,
    state: attempt > 1 ? "retry" : "start",
    attempt,
  });
  try {
    const { value, detail } = await work();
    await emit({
      type: "stage",
      kind,
      stage,
      state: "done",
      ms: Date.now() - started,
      detail,
    });
    return value;
  } catch (error) {
    await emit({
      type: "stage",
      kind,
      stage,
      state: "error",
      attempt,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function markStatus(
  runId: string,
  status: "parsing" | "evaluating",
): Promise<void> {
  "use step";
  await setRunStatus(runId, status);
}

/** Parser service: the Document's text and where each piece sits on the page. */
async function parseStep(
  packSlug: string,
  kind: DocumentKind,
): Promise<ParsedDocument> {
  "use step";
  const { pack, document } = packAndDocument(packSlug, kind);
  return staged(kind, "parse", async () => {
    const parsed = await parseDocument({
      url: await signedUrl(storagePath(pack.slug, document.file)),
      sourceFormat: document.sourceFormat,
    });
    await emit({
      type: "spans",
      kind,
      parser: parsed.parser,
      pageCount: parsed.pageCount,
      spans: parsed.spans.map(({ ref, page, text, box }) => ({
        ref,
        page,
        text,
        box,
      })),
    });
    return {
      value: parsed,
      detail: `${parsed.parser} · ${parsed.spans.length} spans`,
    };
  });
}
parseStep.maxRetries = 2;

async function download(path: string) {
  const response = await fetch(await signedUrl(path));
  if (!response.ok) throw new Error(`Could not download ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

function pageImages(pack: Pack, document: PackDocument) {
  return Promise.all(
    document.pages.map(async (file) => ({
      data: await download(storagePath(pack.slug, file)),
      mediaType: file.endsWith(".png") ? "image/png" : "image/jpeg",
    })),
  );
}

/**
 * The model reads each field as Span references, streamed field by field; code
 * then verifies every reading against its Spans and marks its Field check.
 */
async function readStep(
  packSlug: string,
  kind: DocumentKind,
  spans: Span[],
): Promise<ExtractedDocument> {
  "use step";
  const { pack, document } = packAndDocument(packSlug, kind);
  const extracted = await staged(kind, "read", async () => {
    const extraction = await extractDocument({
      kind,
      spans,
      pageImages: await pageImages(pack, document),
      onReading: (reading) => emit({ type: "field", kind, reading }),
    });
    const value: ExtractedDocument = {
      kind,
      spans,
      fields: extraction.readings.map((reading) =>
        verifyReading(reading, spans),
      ),
      judgments: extraction.judgments,
    };
    return { value, detail: `${value.fields.length} fields` };
  });

  await emit({
    type: "checks",
    kind,
    checks: fieldChecks(extracted, {
      rulebook: individualOnboarding,
      prescreenDate: pack.prescreenDate,
      declaration: pack.clientDeclaration,
    }),
    judgments: extracted.judgments,
  });
  return extracted;
}
readStep.maxRetries = 2;

type ProcessedDocument = {
  parsed: Omit<ParsedDocument, "spans">;
  extracted: ExtractedDocument;
};

/** Evaluates the Rulebook, persists the whole chain and ends the stream. */
async function saveStep(
  runId: string,
  packSlug: string,
  processed: ProcessedDocument[],
): Promise<void> {
  "use step";
  const pack = findPack(packSlug);
  if (!pack) throw new Error(`Unknown pack ${packSlug}`);
  const rulebook = individualOnboarding;

  const saved = new Map<DocumentKind, SavedDocument>();
  for (const { parsed, extracted } of processed) {
    const document = pack.documents.find(
      (item) => item.kind === extracted.kind,
    );
    if (!document) continue;
    saved.set(
      extracted.kind,
      await saveDocument(
        runId,
        {
          storagePath: storagePath(pack.slug, document.file),
          mediaType: document.mediaType,
          sourceFormat: document.sourceFormat,
          parser: parsed.parser,
          pageCount: parsed.pageCount,
        },
        extracted,
      ),
    );
  }

  const findings = evaluate({
    rulebook,
    prescreenDate: pack.prescreenDate,
    declaration: pack.clientDeclaration,
    documents: processed.map(({ extracted }) => extracted),
  });
  await saveFindings(runId, findings, saved);
  await emit({ type: "findings", findings: findingViews(rulebook, findings) });
  await emit({ type: "end", status: "completed" });
  await getWritable().close();
}

async function failStep(runId: string, message: string): Promise<void> {
  "use step";
  await failRun(runId, message);
  await emit({ type: "end", status: "failed", error: message });
  await getWritable().close();
}

/**
 * One Pre-screen run (ADR 0003): every Document is parsed and read in parallel,
 * each stage a retryable step, then the Rulebook is evaluated over all of them.
 */
export async function prescreenWorkflow(input: {
  runId: string;
  packSlug: string;
  kinds: DocumentKind[];
}) {
  "use workflow";
  const { runId, packSlug, kinds } = input;
  try {
    await markStatus(runId, "parsing");
    const processed = await Promise.all(
      kinds.map(async (kind): Promise<ProcessedDocument> => {
        const { spans, ...parsed } = await parseStep(packSlug, kind);
        return { parsed, extracted: await readStep(packSlug, kind, spans) };
      }),
    );
    await markStatus(runId, "evaluating");
    await saveStep(runId, packSlug, processed);
  } catch (error) {
    await failStep(
      runId,
      error instanceof Error ? error.message : String(error),
    );
  }
}
