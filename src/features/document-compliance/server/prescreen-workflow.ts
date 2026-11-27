import { getStepMetadata, getWritable } from "workflow";
import type { Owner } from "@/features/access/domain/owner";
import type { AppliedRule } from "../domain/rules";
import type { DocumentKind, Span } from "../domain/types";
import type { ScanEvent } from "../scan-events";
import { documentCompliance } from "./container";
import type { ParsedDocument } from "./parsers";
import type { PrescreenRun, ProcessedDocument } from "./services/prescreen";

/*
 * The function and step names below (and this file's path) are the
 * workflow's replay keys: never rename or move them. Each step only streams
 * and hands its work to the Pre-screen service (`services/prescreen.ts`).
 */

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

/** What every step of one run needs to know; plain data, so steps can take it. */
type RunContext = PrescreenRun & {
  /** A stubbed e2e run: the scripted reader stands in for the model. */
  stub?: boolean;
};

/** The services, stubbed as the run was started; a run from before stubbing is live. */
const servicesOf = (run?: Pick<RunContext, "stub">) =>
  documentCompliance({ stub: run?.stub === true });

/**
 * Runs one stage of one Document inside a step, streaming its start (or retry),
 * finish and failure so the run page can show them as they happen. Returns the
 * stage's value and how long it took.
 */
async function staged<T>(
  kind: DocumentKind,
  stage: "parse" | "read",
  work: () => Promise<{ value: T; detail: string }>,
): Promise<{ value: T; ms: number }> {
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
    const ms = Date.now() - started;
    await emit({ type: "stage", kind, stage, state: "done", ms, detail });
    return { value, ms };
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
  await servicesOf().prescreen.markStatus(runId, status);
}

type TimedParse = ParsedDocument & { parseMs: number };

/** The Document's text and where each piece sits on the page (ADR 0004). */
async function parseStep(
  packSlug: string,
  kind: DocumentKind,
): Promise<TimedParse> {
  "use step";
  const { value, ms } = await staged(kind, "parse", async () => {
    const parsed = await servicesOf().prescreen.parse(packSlug, kind);
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
  return { ...value, parseMs: ms };
}
parseStep.maxRetries = 2;

/**
 * The model corrects OCR'd Span text and reads each field as Span references,
 * streamed field by field; code then verifies every reading against the
 * corrected Spans and marks its Field check.
 */
async function readStep(
  run: RunContext,
  kind: DocumentKind,
  ocrSpans: Span[],
  ocr: boolean,
): Promise<Pick<ProcessedDocument, "extracted" | "read">> {
  "use step";
  const { prescreen } = servicesOf(run);
  const { value: read, ms } = await staged(kind, "read", async () => {
    const result = await prescreen.read(run, kind, ocrSpans, ocr, (reading) =>
      emit({ type: "field", kind, reading }),
    );
    if (result.corrections.length > 0) {
      await emit({
        type: "corrections",
        kind,
        corrections: result.corrections,
      });
    }
    const applied = result.corrections.length;
    return {
      value: result,
      detail: `${result.extracted.fields.length} fields${applied > 0 ? ` · ${applied} OCR fixes` : ""}`,
    };
  });
  const { extracted, usage, raw } = read;
  // Only the attempt that succeeded is kept, so only its usage is streamed.
  await emit({ type: "usage", kind, usage });
  const checks = await prescreen.finishRead(run, extracted, usage, ms);
  await emit({
    type: "checks",
    kind,
    checks,
    judgments: extracted.judgments,
  });
  return { extracted, read: { usage, readMs: ms, raw } };
}
readStep.maxRetries = 2;

/** Evaluates the Rulebook, persists the whole chain and ends the stream. */
async function saveStep(
  run: RunContext,
  processed: ProcessedDocument[],
): Promise<void> {
  "use step";
  const findings = await servicesOf(run).prescreen.save(run, processed);
  await emit({ type: "findings", findings });
  await emit({ type: "end", status: "completed" });
  await getWritable().close();
}

async function failStep(run: RunContext, message: string): Promise<void> {
  "use step";
  await servicesOf(run).prescreen.fail(run, message);
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
  rules?: AppliedRule[];
  owner?: Owner;
  stub?: boolean;
}) {
  "use workflow";
  const { runId, packSlug, kinds } = input;
  const run: RunContext = {
    runId,
    packSlug,
    rules: input.rules ?? null,
    owner: input.owner ?? null,
    stub: input.stub === true,
  };
  try {
    await markStatus(runId, "parsing");
    const processed = await Promise.all(
      kinds.map(async (kind): Promise<ProcessedDocument> => {
        const { spans, parseMs, ...parsed } = await parseStep(packSlug, kind);
        const { extracted, read } = await readStep(
          run,
          kind,
          spans,
          parsed.parser === "tesseract",
        );
        return { parsed: { ...parsed, parseMs }, extracted, read };
      }),
    );
    await markStatus(runId, "evaluating");
    await saveStep(run, processed);
  } catch (error) {
    await failStep(run, error instanceof Error ? error.message : String(error));
  }
}
