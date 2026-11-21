import { z } from "zod";
import { LIMITS } from "./limits";
import { MARKETS, SPECIMENS } from "./samples";

const SPECIMEN_SLUGS = new Set(SPECIMENS.map((s) => s.slug));
const MARKET_IDS = new Set(MARKETS.map((m) => m.id));

const DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;

export type DecodedImage = {
  bytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
};

/**
 * Pure magic-byte check on uploaded image bytes. Never trusts the data URL mime
 * prefix alone: validates PNG, JPEG, or WebP signatures and byte cap.
 */
export function inspectImageBytes(
  bytes: Uint8Array,
):
  | { ok: true; mediaType: DecodedImage["mediaType"] }
  | { ok: false; error: string } {
  if (bytes.byteLength < 12) {
    return { ok: false, error: "Image file is too small or corrupted." };
  }
  if (bytes.byteLength > LIMITS.maxUploadBytes) {
    return {
      ok: false,
      error: `Image exceeds the ${Math.round(LIMITS.maxUploadBytes / (1024 * 1024))} MB limit.`,
    };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ok: true, mediaType: "image/png" };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mediaType: "image/jpeg" };
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ok: true, mediaType: "image/webp" };
  }
  return {
    ok: false,
    error: "Only PNG, JPEG, or WebP images are supported.",
  };
}

/** Decodes and validates a base64 image data URL using magic-byte inspection. */
export function decodeImageDataUrl(
  dataUrl: string,
): { ok: true; image: DecodedImage } | { ok: false; error: string } {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    return { ok: false, error: "Invalid image data URL." };
  }
  const b64 = match[2];
  // Quick pre-decode byte length guard
  const estimatedBytes = Math.floor((b64.length * 3) / 4);
  if (estimatedBytes > LIMITS.maxUploadBytes + 1024) {
    return {
      ok: false,
      error: `Image exceeds the ${Math.round(LIMITS.maxUploadBytes / (1024 * 1024))} MB limit.`,
    };
  }
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  const checked = inspectImageBytes(bytes);
  if (!checked.ok) return checked;
  return {
    ok: true,
    image: { bytes, mediaType: checked.mediaType },
  };
}

export const modelTierSchema = z.enum(["flash", "flagship"]).default("flash");

export const productSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("specimen"),
    slug: z
      .string()
      .refine((v) => SPECIMEN_SLUGS.has(v), "Unknown specimen product."),
  }),
  z.object({
    kind: z.literal("custom"),
    name: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(80).default("Custom Product"),
    materialNotes: z.string().trim().max(LIMITS.maxPromptChars).default(""),
    imageDataUrl: z.string().min(32),
  }),
]);

export const extractRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("isolate"),
    imageDataUrl: z.string().min(32),
    productName: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    mode: z.literal("synthesize"),
    concept: z.string().trim().min(4).max(LIMITS.maxPromptChars),
    productName: z.string().trim().min(1).max(80).optional(),
  }),
]);

export const shootRequestSchema = z.object({
  product: productSourceSchema,
  marketIds: z
    .array(z.string().refine((id) => MARKET_IDS.has(id), "Unknown market."))
    .min(1)
    .max(LIMITS.maxMarketsPerShoot)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Duplicate market selection.",
    ),
  tier: modelTierSchema,
  customBrief: z.string().trim().max(LIMITS.maxPromptChars).optional(),
  moodReferenceDataUrl: z.string().min(32).optional(),
});

export const editRequestSchema = z.object({
  product: productSourceSchema,
  baseImageDataUrl: z.string().min(32),
  marketId: z.string().refine((id) => MARKET_IDS.has(id), "Unknown market."),
  instruction: z.string().trim().min(4).max(LIMITS.maxPromptChars),
  tier: modelTierSchema,
  referenceImageDataUrl: z.string().min(32).optional(),
});

export const auditRequestSchema = z.object({
  product: productSourceSchema,
  stagedImageDataUrl: z.string().min(32),
  marketId: z.string().refine((id) => MARKET_IDS.has(id), "Unknown market."),
  directionSummary: z.string().trim().max(400).optional(),
});

export const compareRequestSchema = z.object({
  product: productSourceSchema,
  marketId: z.string().refine((id) => MARKET_IDS.has(id), "Unknown market."),
  customBrief: z.string().trim().max(LIMITS.maxPromptChars).optional(),
});
