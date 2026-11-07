import "server-only";
import { createGateway, Output, streamText } from "ai";
import { z } from "zod";
import {
  type DocumentJudgments,
  type DocumentKind,
  FIELD_NAMES,
  type FieldName,
  type FieldReading,
  type Span,
} from "../domain/types";
import { env } from "./env";

/** The fields worth reading from each kind of Document. */
const FIELDS_BY_KIND: Record<DocumentKind, FieldName[]> = {
  identity_document: [
    "full_name",
    "date_of_birth",
    "date_of_issue",
    "date_of_expiry",
    "mrz_date_of_expiry",
  ],
  proof_of_address: ["full_name", "statement_date", "address"],
  certified_copy: [
    "full_name",
    "date_of_birth",
    "date_of_expiry",
    "certification_wording",
    "certifier_name",
    "certifier_occupation",
    "certification_date",
  ],
};

const FIELD_HINTS: Record<FieldName, string> = {
  full_name:
    "the holder's or account holder's full name; combine surname and given names when printed separately",
  date_of_birth: "date of birth as printed",
  date_of_issue: "date of issue as printed",
  date_of_expiry: "date of expiry as printed in the visual zone",
  mrz_date_of_expiry:
    "the 6-digit YYMMDD expiry from line 2 of the machine-readable zone (characters 22-27)",
  statement_date: "the statement or issue date of the bill",
  address: "the postal address the document is addressed to, all lines",
  certification_wording: "the sentence certifying the copy is true",
  certifier_name: "the certifier's name",
  certifier_occupation: "the certifier's occupation or profession",
  certification_date: "the date the copy was certified",
};

const KIND_LABELS: Record<DocumentKind, string> = {
  identity_document: "an identity document (passport data page)",
  proof_of_address: "a proof of address (utility bill)",
  certified_copy: "a certified copy of an identity document",
};

const extractionSchema = z.object({
  fields: z.array(
    z.object({
      name: z.enum(FIELD_NAMES),
      value: z.string(),
      spanRefs: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
  judgments: z.object({
    legible: z.boolean(),
    tamperingSuspected: z.boolean(),
    tamperingSpanRefs: z.array(z.string()),
    signaturePresent: z.boolean().nullable(),
    notes: z.string(),
  }),
});

const INSTRUCTIONS = `You read one Document submitted for client onboarding at a regulated bank and report what is printed on it. You never decide whether the client passes; code does that from your readings.

You get the page images and a list of Spans: every piece of text a parser found, as "ref | page | text".

Fields:
- Report only the requested fields that are actually printed. Leave out any field that is absent or left blank on the document.
- Copy each value exactly as printed, taken from the Spans. If a value is split across Spans, combine them in reading order.
- spanRefs lists every Span you took the value from. Use only refs from the list.
- confidence is 0 to 1: how sure you are the value is correct and complete.

Judgments, from the page images:
- legible: false if a reviewer could not read any requested field.
- tamperingSuspected: true on signs of alteration, such as a value in a different font or size, a patch or misalignment behind text, or printed data contradicting the machine-readable zone.
- tamperingSpanRefs: refs of the Spans affected by suspected tampering, otherwise empty.
- signaturePresent: for a certified copy, whether the certification carries a handwritten signature; null for other documents.
- notes: one sentence explaining any tampering or legibility concern, otherwise empty.`;

export type DocumentExtraction = {
  readings: FieldReading[];
  judgments: DocumentJudgments;
};

type ExtractedItem = z.infer<typeof extractionSchema>["fields"][number];

/**
 * Reads one Document with the model, streaming: `onReading` gets each field as
 * soon as the model has finished writing it, before the whole answer is in.
 */
export async function extractDocument(input: {
  kind: DocumentKind;
  spans: Span[];
  pageImages: { data: Uint8Array; mediaType: string }[];
  onReading?: (reading: FieldReading) => Promise<void>;
}): Promise<DocumentExtraction> {
  const requested = FIELDS_BY_KIND[input.kind]
    .map((name) => `- ${name}: ${FIELD_HINTS[name]}`)
    .join("\n");
  const spanList = input.spans
    .map((span) => `${span.ref} | ${span.page} | ${span.text}`)
    .join("\n");

  const gateway = createGateway({ apiKey: env.aiGatewayApiKey() });
  const result = streamText({
    model: gateway(env.model()),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: extractionSchema }),
    providerOptions: { openai: { reasoningEffort: "low" } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is ${KIND_LABELS[input.kind]}.\n\nRequested fields:\n${requested}\n\nSpans:\n${spanList}`,
          },
          ...input.pageImages.map((image) => ({
            type: "file" as const,
            mediaType: image.mediaType,
            data: image.data,
          })),
        ],
      },
    ],
  });

  const allowed = new Set(FIELDS_BY_KIND[input.kind]);
  const toReading = (field: ExtractedItem): FieldReading | null =>
    allowed.has(field.name)
      ? { ...field, confidence: Math.min(1, Math.max(0, field.confidence)) }
      : null;

  // A partial array's last item may still be streaming; every earlier one is complete.
  let reported = 0;
  const report = async (fields: ExtractedItem[]) => {
    for (; reported < fields.length; reported++) {
      const reading = toReading(fields[reported]);
      if (reading) await input.onReading?.(reading);
    }
  };
  for await (const partial of result.partialOutputStream) {
    const complete = (partial.fields ?? []).slice(0, -1);
    if (complete.every(isComplete)) await report(complete as ExtractedItem[]);
  }

  const output = await result.output;
  await report(output.fields);
  return {
    readings: output.fields.flatMap((field) => toReading(field) ?? []),
    judgments: output.judgments,
  };
}

function isComplete(field: unknown): field is ExtractedItem {
  return extractionSchema.shape.fields.element.safeParse(field).success;
}
