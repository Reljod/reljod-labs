import "server-only";
import { evaluate } from "../domain/evaluate";
import { individualOnboarding } from "../domain/rulebook";
import type { DocumentKind, ExtractedDocument } from "../domain/types";
import { verifyReading } from "../domain/verify";
import { type Pack, storagePath } from "../packs";
import { env } from "./env";
import { extractDocument } from "./extract";
import { parseDocument } from "./parser-client";
import {
  createRun,
  failRun,
  type SavedDocument,
  saveDocument,
  saveFindings,
  setRunStatus,
} from "./repository";
import { signedUrl } from "./supabase";

async function download(path: string) {
  const response = await fetch(await signedUrl(path));
  if (!response.ok) throw new Error(`Could not download ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Runs a Pre-screen end to end: parse each Document into Spans, have the model
 * read fields as Span references, verify them in code, evaluate the Rulebook,
 * and persist the whole chain. Returns the run id; a failure is stored on the run.
 */
export async function runPrescreen(pack: Pack, visitorHash: string) {
  const rulebook = individualOnboarding;
  const runId = await createRun({
    packSlug: pack.slug,
    rulebook,
    declaration: pack.clientDeclaration,
    visitorHash,
    model: env.model(),
  });

  try {
    const parsed = await Promise.all(
      pack.documents.map(async (document) => ({
        document,
        result: await parseDocument({
          url: await signedUrl(storagePath(pack.slug, document.file)),
          sourceFormat: document.sourceFormat,
        }),
      })),
    );

    await setRunStatus(runId, "extracting");
    const extracted = await Promise.all(
      parsed.map(async ({ document, result }) => {
        const pageImages = await Promise.all(
          document.pages.map(async (file) => ({
            data: await download(storagePath(pack.slug, file)),
            mediaType: file.endsWith(".png") ? "image/png" : "image/jpeg",
          })),
        );
        const extraction = await extractDocument({
          kind: document.kind,
          spans: result.spans,
          pageImages,
        });
        const extractedDocument: ExtractedDocument = {
          kind: document.kind,
          spans: result.spans,
          fields: extraction.readings.map((reading) =>
            verifyReading(reading, result.spans),
          ),
          judgments: extraction.judgments,
        };
        return { document, result, extractedDocument };
      }),
    );

    await setRunStatus(runId, "evaluating");
    const saved = new Map<DocumentKind, SavedDocument>();
    for (const { document, result, extractedDocument } of extracted) {
      saved.set(
        document.kind,
        await saveDocument(
          runId,
          {
            storagePath: storagePath(pack.slug, document.file),
            mediaType: document.mediaType,
            sourceFormat: document.sourceFormat,
            parser: result.parser,
            pageCount: result.pageCount,
          },
          extractedDocument,
        ),
      );
    }

    const findings = evaluate({
      rulebook,
      prescreenDate: pack.prescreenDate,
      declaration: pack.clientDeclaration,
      documents: extracted.map(({ extractedDocument }) => extractedDocument),
    });
    await saveFindings(runId, findings, saved);
    return { runId, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(runId, message);
    return { runId, error: message };
  }
}
