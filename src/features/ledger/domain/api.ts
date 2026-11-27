/**
 * Ledger's HTTP contract: the paths the browser calls, what each takes and
 * what each answers. Both are writes on the REST pipeline (`server/api.ts`);
 * the Build answers as NDJSON `BuildEvent`s.
 */
import { z } from "zod";
import { cleanQuestion } from "./presets";

export const API = "/api/ledger";

export const ROUTES = {
  /** POST: open an Ask session for a question. */
  sessions: `${API}/sessions`,
  /** POST: plan the session's next Build, streamed. */
  builds: (sessionId: string) => `${API}/sessions/${sessionId}/builds`,
} as const;

/** e2e only (with the e2e token): behave as if the visitor were over the rate limit. */
export const FORCE_LIMIT_HEADER = "x-ledger-force-limit";

/** A visitor's question, cleaned; empty when nothing is left of it. */
export const questionSchema = z.object({
  question: z
    .unknown()
    .transform((value) => cleanQuestion(String(value ?? ""))),
});

export type StartAskResult =
  | { status: "started"; sessionId: string }
  | { status: "limited"; sessionId: string | null; message: string }
  | { status: "empty" };
