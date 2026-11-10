import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  DOCUMENT_KIND_IDS,
  DOCUMENT_KINDS,
  type DocumentKind,
} from "../../domain/document-kinds";
import type { RunDocument } from "../../domain/run-state";
import { type CallCost, callOptions, trackCall } from "../llm";
import { download } from "../supabase";
import type { RunContext } from "./context";

const KIND_LIST = DOCUMENT_KIND_IDS.map(
  (kind) =>
    `- ${kind}: ${DOCUMENT_KINDS[kind].label}. ${DOCUMENT_KINDS[kind].looksLike}`,
).join("\n");

const INSTRUCTIONS = `You sort documents arriving at the pension and onboarding desk of a Cayman Islands bank and trust company. Look at the first page and say which kind of document it is.

Kinds:
${KIND_LIST}
- other: none of the above.

gist: one short line a reviewer would write on the folder tab, naming the person or company and the key fact, e.g. "Rivers: CI$62,500 home purchase request" or "Lumen Harbour register of members". At most 9 words.
confidence: 0 to 1.`;

const sortSchema = z.object({
  kind: z.enum(["other", ...DOCUMENT_KIND_IDS] as [string, ...string[]]),
  gist: z.string(),
  confidence: z.number(),
});

/** One Document's kind, from its first page image or the head of its CSV. */
export async function sortDocument(
  ctx: RunContext,
  document: RunDocument,
): Promise<{ kind: DocumentKind | null; gist: string; cost: CallCost }> {
  const started = Date.now();
  const settings = ctx.settings.sort;
  const content: (
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: Uint8Array }
  )[] = [{ type: "text", text: `File name: ${document.name}` }];
  if (document.sourceFormat === "csv" && document.storagePath) {
    const csv = new TextDecoder().decode(await download(document.storagePath));
    content.push({
      type: "text",
      text: `First lines:\n${csv.split("\n").slice(0, 8).join("\n")}`,
    });
  } else {
    const first = document.pagePaths?.[0] ?? document.storagePath;
    if (first) {
      content.push({
        type: "file",
        mediaType: "image/jpeg",
        data: await download(first),
      });
    }
  }
  const result = await generateText({
    ...callOptions(settings),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: sortSchema }),
    messages: [{ role: "user", content }],
  });
  const cost = await trackCall({
    purpose: "sort",
    model: settings.model,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
    started,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
  });
  const kind = (DOCUMENT_KIND_IDS as string[]).includes(result.output.kind)
    ? (result.output.kind as DocumentKind)
    : null;
  return { kind, gist: result.output.gist, cost };
}
