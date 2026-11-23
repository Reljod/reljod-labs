/**
 * The HTTP contract: every path the browser calls and what each answers. A
 * Turn and a Debrief are POSTs that stream NDJSON (they spend, and their
 * words arrive as the model writes them); the allowance is a gated GET.
 * Nothing is saved: the browser holds the drill and sends its Rounds back.
 */
import { z } from "zod";
import type { Choice, Outcome } from "./engine";
import { LIMITS } from "./limits";
import type { Scorecard } from "./review";
import type { Finding } from "./rules";
import type { GaugeId } from "./scenario";
import type { StatementNote } from "./statement";

export const API = "/api/firebreak";

export const paths = {
  turns: `${API}/turns`,
  debrief: `${API}/debrief`,
  allowance: `${API}/allowance`,
} as const;

/** The header the end-to-end test sends for canned model output; honoured only with the e2e token. */
export const STUB_HEADER = "x-firebreak-stub";

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9/_-]+$/);

export const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("option"), option: id }),
  z.object({
    kind: z.literal("own"),
    text: z
      .string()
      .trim()
      .min(3, "Write a decision of a few words.")
      .max(LIMITS.ownWords, `Keep it under ${LIMITS.ownWords} characters.`),
  }),
]) satisfies z.ZodType<Choice>;

export const roundSchema = z.object({
  inject: id,
  choice: choiceSchema,
  levers: z.array(id).max(3),
});

/** What the Room said in an earlier Round, sent back so the next Round remembers it. */
export const echoSchema = z.object({
  headline: z.string().max(LIMITS.echoChars),
  lines: z.array(z.string().max(LIMITS.echoChars)).max(4),
});
export type Echo = z.infer<typeof echoSchema>;

export const turnRequestSchema = z.object({
  scenario: id,
  rounds: z.array(roundSchema).max(6),
  echoes: z.array(echoSchema).max(6),
  current: z.object({ inject: id, choice: choiceSchema }),
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;

export const debriefRequestSchema = z.object({
  scenario: id,
  rounds: z.array(roundSchema).min(1).max(6),
  echoes: z.array(echoSchema).max(6),
});
export type DebriefRequest = z.infer<typeof debriefRequestSchema>;

export type Usage = {
  call: "reader" | "room" | "draft";
  model: string;
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

export type Voice = { who: GaugeId; line: string; mood: number };
export type Headline = { outlet: string; text: string };
export type Post = { handle: string; text: string };

/** One line of a Turn's NDJSON stream. */
export type TurnEvent =
  | { t: "start"; model: string }
  | { t: "reading"; heard: string; levers: string[]; outside: string | null }
  | { t: "outcome"; outcome: Outcome; levers: string[]; findings: Finding[] }
  | { t: "voice"; voice: Voice }
  | { t: "headline"; headline: Headline }
  | { t: "post"; post: Post }
  | { t: "whisper"; text: string }
  | { t: "next"; inject: string | null }
  | { t: "usage"; usage: Usage }
  | { t: "done" }
  | { t: "error"; message: string };

/** One line of a Debrief's NDJSON stream. */
export type DebriefEvent =
  | { t: "start"; model: string }
  | { t: "scorecard"; scorecard: Scorecard }
  | { t: "lessons"; lessons: string[] }
  | { t: "draft"; n: number; text: string; final: boolean }
  | { t: "notes"; n: number; notes: StatementNote[]; passed: boolean }
  | { t: "usage"; usage: Usage }
  | { t: "done"; passed: boolean }
  | { t: "error"; message: string };

export type Allowance = {
  used: number;
  perHour: number;
  model: string;
};
