/**
 * The HTTP contract: every path the browser calls and what each answers.
 * A Pass is a POST that streams NDJSON (it spends, and its marks arrive as
 * the model writes them); the allowance is a gated GET.
 */
import { z } from "zod";
import type { Drawing, Mark, Swatch, TypeStep } from "./drawing";
import { LIMITS } from "./limits";

export const API = "/api/vellum";

export const paths = {
  passes: `${API}/passes`,
  allowance: `${API}/allowance`,
} as const;

/** The header the end-to-end test sends for a canned Pass; honoured only with the e2e token. */
export const STUB_HEADER = "x-vellum-stub";

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Base64 grows bytes by 4/3; this bounds the string before it is decoded. */
const MAX_DATA_URL = Math.ceil((LIMITS.imageBytes * 4) / 3) + 64;

const dataUrl = z
  .string()
  .max(MAX_DATA_URL, "That image is too large. Try a smaller screenshot.")
  .regex(DATA_URL, "Send a PNG, JPEG or WebP image.");

const side = z.number().int().min(16).max(LIMITS.imageSide);

/** One region the Ruler scored low, in Sheet units, for the next Pass. */
export const noteSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  original: z.string().regex(/^#[0-9a-f]{6}$/),
  drawn: z.string().regex(/^#[0-9a-f]{6}$/),
  likeness: z.number().min(0).max(1),
});
export type Note = z.infer<typeof noteSchema>;

export const passRequestSchema = z
  .object({
    pass: z.number().int().min(1).max(LIMITS.passesPerTrace),
    width: side,
    height: side,
    screenshot: dataUrl,
    /** The same screenshot with the Sheet's grid ruled over it. */
    squared: dataUrl,
    /** The last Pass's Drawing; sanitized again on the server. */
    previous: z.unknown().optional(),
    /** The last Pass's Drawing as the browser rendered it. */
    rendering: dataUrl.optional(),
    likeness: z.number().min(0).max(1).optional(),
    notes: z.array(noteSchema).max(LIMITS.notes).optional(),
  })
  .refine(
    (request) =>
      request.pass === 1 ||
      (request.previous !== undefined && request.rendering !== undefined),
    { message: "A later Pass needs the last Drawing and its rendering." },
  );
export type PassRequest = z.infer<typeof passRequestSchema>;

export type PassUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ms: number;
};

/** One line of a Pass's NDJSON stream. */
export type PassEvent =
  | { t: "start"; pass: number; model: string }
  | { t: "swatch"; swatch: Swatch }
  | { t: "type"; step: TypeStep }
  | { t: "background"; hex: string }
  | { t: "mark"; mark: Mark }
  | { t: "done"; drawing: Drawing; usage: PassUsage }
  | { t: "error"; message: string };

export type Allowance = {
  used: number;
  perHour: number;
  model: string;
};
