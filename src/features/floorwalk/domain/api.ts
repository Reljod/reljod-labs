/**
 * The HTTP contract between the Floorwalk page and its routes. Reads and the
 * streaming Walk are routes; preparing an upload is a server action.
 */
import { z } from "zod";
import { LIMITS } from "./limits";
import type { Finding, Noticed, RefusalReason, Sighting } from "./walk";

export const ROUTES = {
  allowance: "/api/floorwalk/allowance",
  walks: "/api/floorwalk/walks",
  asks: "/api/floorwalk/asks",
} as const;

/** Request header that swaps the model for a scripted Walker (e2e, with the bypass token). */
export const STUB_HEADER = "x-floorwalk-stub";

const uploadPath = z
  .string()
  .regex(
    /^uploads\/[a-z0-9-]{1,80}\/[0-9a-f-]{36}\.(mp4|mov)$/,
    "That upload is not one of yours.",
  );

export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sample"),
    slug: z.string().regex(/^[a-z-]{1,40}$/),
  }),
  z.object({ kind: z.literal("upload"), path: uploadPath }),
]);
export type Source = z.infer<typeof sourceSchema>;

export const walkRequestSchema = z.object({ source: sourceSchema });

export const askRequestSchema = z.object({
  source: sourceSchema,
  question: z
    .string()
    .trim()
    .min(3, "Ask a question about the footage.")
    .max(
      LIMITS.questionChars,
      `Keep the question under ${LIMITS.questionChars} characters.`,
    ),
});

export const uploadRequestSchema = z.object({
  type: z.enum(["video/mp4", "video/quicktime"], "Upload an MP4 or MOV."),
  size: z
    .number()
    .int()
    .positive()
    .max(LIMITS.uploadBytes, "That file is over 25 MB."),
});

export type Allowance = {
  walksUsed: number;
  walksPerHour: number;
  asksUsed: number;
  asksPerHour: number;
  model: string;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

/** One line of a Walk's NDJSON stream. */
export type WalkEvent =
  | { t: "start"; model: string; seconds: number; rules: string[] }
  | { t: "zone"; at: number; zone: string }
  | { t: "finding"; finding: Finding }
  | { t: "merged"; into: string; at: number }
  | { t: "noticed"; noticed: Noticed }
  | { t: "refused"; reason: RefusalReason; sighting: Sighting }
  | { t: "raw"; line: string }
  | { t: "done"; ms: number; usage: Usage; skipped: number }
  | { t: "error"; message: string };

/** A recorded Walk of a Sample: the same events with the milliseconds they arrived at. */
export type Recording = {
  slug: string;
  model: string;
  recordedAt: string;
  events: { ms: number; event: WalkEvent }[];
};

export type Moment = {
  at: number;
  box: [number, number, number, number] | null;
  label: string;
};
export type AskAnswer = {
  answer: string;
  moments: Moment[];
  usage: Usage;
  ms: number;
};

export type UploadTicket = { path: string; signedUrl: string };
