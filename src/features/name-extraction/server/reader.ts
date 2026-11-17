import "server-only";
import { generateText, Output } from "ai";
import type { ExtractedName } from "../domain/contract";
import { type CallCost, callOptions, trackCall } from "./llm";
import {
  READER_INSTRUCTIONS,
  readerPages,
  renderRulebook,
} from "./toolkit/prompt";
import { readerNames, readerOutputSchema } from "./toolkit/register";
import { RUN_LIMITS, type RunContext } from "./toolkit/state";

export type ReaderJob = {
  readerId: string;
  from: number;
  to: number;
  model: string;
  focus?: string;
  instructions?: string;
};

export type ReaderResult = {
  readerId: string;
  from: number;
  to: number;
  model: string;
  names: ExtractedName[];
  dropped: number;
  cost: CallCost | null;
  error?: string;
  ms: number;
};

/** The schema in words, after the Rulebook: the last part of the cached prefix. */
const SCHEMA_NOTE = `Answer with JSON: { "names": [ { "name", "type", "role", "quotes": [ { "page", "quote" } ], "confidence", "note"? } ] }. An empty list is a valid answer for pages that name nobody.`;

/**
 * One Reader over one page range. The prompt is ordered for caching: fixed
 * instructions, the Rulebook, the schema, then the pages. Quotes are checked
 * against the pages; names with no verifiable quote are dropped.
 */
export async function runReader(
  ctx: RunContext,
  pages: string[],
  job: ReaderJob,
): Promise<ReaderResult> {
  const started = Date.now();
  const range = { from: job.from, to: job.to };
  try {
    const result = await generateText({
      ...callOptions(job.model, "reader"),
      // A retry would bill a second time against one reservation.
      maxRetries: 0,
      instructions: `${READER_INSTRUCTIONS}\n\n${renderRulebook(ctx.rulebook, ctx.rulebookVersion)}\n\n${SCHEMA_NOTE}`,
      output: Output.object({ schema: readerOutputSchema }),
      maxOutputTokens: RUN_LIMITS.readerOutputTokens,
      messages: [
        {
          role: "user",
          content: [
            job.instructions
              ? `Instructions for this pass: ${job.instructions}`
              : "",
            readerPages(
              pages
                .slice(job.from - 1, job.to)
                .map((text, index) => ({ page: job.from + index, text })),
              job.focus,
            ),
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    const cost = await trackCall({
      runId: ctx.runId,
      purpose: "reader",
      model: job.model,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      started,
    });
    const { names, dropped } = readerNames(pages, result.output, range);
    return {
      ...job,
      names,
      dropped,
      cost,
      ms: Date.now() - started,
    };
  } catch (error) {
    // A reply that failed to parse was still billed: record what it reports.
    const usage = (
      error as { usage?: Parameters<typeof trackCall>[0]["usage"] }
    ).usage;
    const cost = usage
      ? await trackCall({
          runId: ctx.runId,
          purpose: "reader",
          model: job.model,
          usage,
          providerMetadata: undefined,
          started,
        })
      : null;
    return {
      ...job,
      names: [],
      dropped: 0,
      cost,
      error:
        error instanceof Error ? error.message.slice(0, 500) : String(error),
      ms: Date.now() - started,
    };
  }
}
