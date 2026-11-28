import "server-only";
import { createGateway, type ModelMessage, Output, streamText } from "ai";
import { InvalidError } from "@/platform/errors";
import type { PassEvent, PassRequest, PassUsage } from "../domain/api";
import { INSTRUCTIONS, passBrief } from "../domain/brief";
import {
  cleanHex,
  DRAWING_LIMITS,
  type Drawing,
  modelDrawingSchema,
  SHEET_WIDTH,
  type Swatch,
  sanitizeDrawing,
  sanitizeMark,
  sheetHeight,
  type TypeStep,
} from "../domain/drawing";
import { LIMITS } from "../domain/limits";
import { stubDrawing } from "../domain/stub";
import { env } from "./env";
import type { Draftsman } from "./ports";

type Image = { mediaType: string; data: Uint8Array };

const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  // The whole eight-byte PNG signature, not only "\x89PNG".
  "image/png": (b) =>
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => b[index] === byte,
    ),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) =>
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
};

/** A data URL the schema already shaped, decoded and checked against its own type. */
export function decodeImage(dataUrl: string): Image {
  const comma = dataUrl.indexOf(",");
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(";"));
  const data = new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), "base64"));
  if (data.byteLength > LIMITS.imageBytes)
    throw new InvalidError(
      "That image is too large. Try a smaller screenshot.",
    );
  if (!SIGNATURES[mediaType]?.(data))
    throw new InvalidError("That file isn't the image it says it is.");
  return { mediaType, data };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function gatewayCost(providerMetadata: unknown): number | null {
  const meta = isRecord(providerMetadata)
    ? providerMetadata.gateway
    : undefined;
  if (!isRecord(meta)) return null;
  for (const value of [meta.cost, meta.marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number)) return number;
  }
  return null;
}

/**
 * Turns the growing partial Drawing of a stream into events, each part once,
 * and each only when it is complete (the item after it has begun, or the
 * stream has ended). Marks are sanitized one by one as they land.
 */
export function partialReporter(sheet: { width: number; height: number }) {
  let swatches = 0;
  let steps = 0;
  let marks = 0;
  let background = false;
  const markIds = new Set<string>();
  return (partial: unknown, final: boolean): PassEvent[] => {
    const events: PassEvent[] = [];
    if (!isRecord(partial)) return events;
    const palette = Array.isArray(partial.palette) ? partial.palette : [];
    const typeScale = Array.isArray(partial.typeScale) ? partial.typeScale : [];
    const list = Array.isArray(partial.marks) ? partial.marks : [];
    // An array is done growing once a later field has begun.
    const paletteDone =
      final || typeScale.length > 0 || "background" in partial;
    const typeDone = final || "background" in partial || list.length > 0;
    const paletteEnd = paletteDone ? palette.length : palette.length - 1;
    for (; swatches < paletteEnd; swatches++) {
      const raw = palette[swatches] as Partial<Swatch> | undefined;
      const hex = cleanHex(raw?.hex);
      if (hex)
        events.push({
          t: "swatch",
          swatch: { hex, role: String(raw?.role ?? "").slice(0, 40) },
        });
    }
    const typeEnd = typeDone ? typeScale.length : typeScale.length - 1;
    for (; steps < typeEnd; steps++) {
      const step = sanitizeDrawing({ typeScale: [typeScale[steps]] }, sheet)
        .typeScale[0];
      if (step) events.push({ t: "type", step: step as TypeStep });
    }
    if (!background && (list.length > 0 || final)) {
      const hex = cleanHex(partial.background);
      if (hex) {
        background = true;
        events.push({ t: "background", hex });
      }
    }
    const markEnd = final ? list.length : list.length - 1;
    for (; marks < markEnd; marks++) {
      if (markIds.size >= DRAWING_LIMITS.marks) continue;
      const mark = sanitizeMark(list[marks], marks, sheet);
      if (!mark) continue;
      let id = mark.id;
      for (let n = 2; markIds.has(id); n++) id = `${mark.id}-${n}`;
      markIds.add(id);
      events.push({ t: "mark", mark: { ...mark, id } });
    }
    return events;
  };
}

function messages(
  request: PassRequest,
  height: number,
  previous?: Drawing,
): ModelMessage[] {
  const images = [request.screenshot, request.squared, request.rendering]
    .filter((url): url is string => typeof url === "string")
    .map(decodeImage);
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: passBrief({
            pass: request.pass,
            sheetHeight: height,
            previous,
            likeness: request.likeness,
            notes: request.notes,
          }),
        },
        ...images.map((image) => ({
          type: "image" as const,
          image: image.data,
          mediaType: image.mediaType,
        })),
      ],
    },
  ];
}

export type PreparedPass = {
  pass: number;
  sheet: { width: number; height: number };
  prompt: ModelMessage[];
};

/**
 * Checks a Pass request all the way down (every image decoded against its
 * type, the last Drawing sanitized) and builds the prompt. Throws an
 * InvalidError, so a bad request is refused before the rate is taken.
 */
export function preparePass(request: PassRequest): PreparedPass {
  const sheet = {
    width: SHEET_WIDTH,
    height: sheetHeight(request.width, request.height),
  };
  const previous =
    request.pass > 1 && request.previous !== undefined
      ? sanitizeDrawing(request.previous, sheet)
      : undefined;
  return {
    pass: request.pass,
    sheet,
    prompt: messages(request, sheet.height, previous),
  };
}

/**
 * One Pass by the model: the Draftsman looks at the screenshot (and, after
 * the first Pass, its own last Drawing as rendered and the Ruler's notes)
 * and draws. Yields NDJSON events as marks complete. The service has
 * prepared the Pass and taken the rate.
 */
async function* modelPass(
  prepared: PreparedPass,
  signal: AbortSignal,
): AsyncGenerator<PassEvent> {
  const { sheet, prompt } = prepared;
  const report = partialReporter(sheet);
  const started = Date.now();
  const model = env.model();
  yield { t: "start", pass: prepared.pass, model };

  const gateway = createGateway({ apiKey: env.aiGatewayApiKey() });
  const result = streamText({
    model: gateway(model),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: modelDrawingSchema }),
    reasoning: env.reasoning(),
    maxOutputTokens: LIMITS.outputTokens,
    abortSignal: AbortSignal.any([
      signal,
      AbortSignal.timeout(LIMITS.passSeconds * 1000),
    ]),
    messages: prompt,
  });

  for await (const partial of result.partialOutputStream) {
    for (const event of report(partial, false)) yield event;
  }
  const output = await result.output;
  for (const event of report(output, true)) yield event;
  const [usage, providerMetadata] = await Promise.all([
    result.usage,
    result.providerMetadata,
  ]);
  const summary: PassUsage = {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    costUsd: gatewayCost(providerMetadata),
    ms: Date.now() - started,
  };
  yield { t: "done", drawing: sanitizeDrawing(output, sheet), usage: summary };
}

/**
 * The stubbed e2e suite's Pass: the canned Drawing (`domain/stub.ts`)
 * through the same reporter and sanitizer, a mark every 40 ms, no model.
 */
async function* cannedPass(
  prepared: PreparedPass,
  signal: AbortSignal,
): AsyncGenerator<PassEvent> {
  const { sheet } = prepared;
  const started = Date.now();
  yield { t: "start", pass: prepared.pass, model: "stub" };
  const canned = stubDrawing(sheet.height, prepared.pass);
  for (const event of partialReporter(sheet)(canned, true)) {
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
    yield event;
  }
  yield {
    t: "done",
    drawing: sanitizeDrawing(canned, sheet),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      ms: Date.now() - started,
    },
  };
}

/** GPT-6.2 Astra (or `VELLUM_MODEL`) through AI Gateway. */
export const modelDraftsman: Draftsman = {
  get model() {
    return env.model();
  },
  draw: modelPass,
};

/** The canned Draftsman of the stubbed e2e suite. */
export const cannedDraftsman: Draftsman = {
  get model() {
    return env.model();
  },
  draw: cannedPass,
};
