import "server-only";
import { z } from "zod";
import type { SourceFormat, Span } from "../domain/types";
import { env } from "./env";

const spanSchema = z.object({
  ref: z.string(),
  page: z.number().int().positive(),
  text: z.string(),
  granularity: z.enum(["word", "line", "element"]),
  box: z.object({
    x0: z.number(),
    y0: z.number(),
    x1: z.number(),
    y1: z.number(),
  }),
  confidence: z.number().nullable(),
});

const parseResponseSchema = z.object({
  parser: z.enum(["paddleocr", "opendataloader_pdf"]),
  page_count: z.number().int().positive(),
  spans: z.array(spanSchema),
});

export type ParsedDocument = {
  parser: "paddleocr" | "opendataloader_pdf";
  pageCount: number;
  spans: Span[];
};

/**
 * Sends a Document to the parser service (`services/parser`) by signed URL and
 * gets back its Spans. The file never passes through this function's body, which
 * keeps requests under Vercel's 4.5 MB limit (ADR 0002).
 */
export async function parseDocument(input: {
  url: string;
  sourceFormat: SourceFormat;
}): Promise<ParsedDocument> {
  const response = await fetch(`${env.parserUrl()}/parse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.parserToken()}`,
    },
    body: JSON.stringify({ url: input.url, source_format: input.sourceFormat }),
  });
  if (!response.ok) {
    throw new Error(
      `Parser returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const body = parseResponseSchema.parse(await response.json());
  return { parser: body.parser, pageCount: body.page_count, spans: body.spans };
}
