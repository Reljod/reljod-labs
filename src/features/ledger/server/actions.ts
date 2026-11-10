"use server";

import { requireAccess } from "@/features/access/server/gate";
import { cleanQuestion } from "../domain/presets";
import { rateLimitMessage } from "./rate-limit";
import { createAskSession, latestAnsweredSessionId } from "./repository";
import { currentVisitor } from "./visitor";

export type StartAskResult =
  | { status: "started"; sessionId: string }
  | { status: "limited"; sessionId: string | null; message: string }
  | { status: "empty" };

/** Opens an Ask session for a question; the session page plays its first Build. */
export async function startAskSession(
  question: string,
): Promise<StartAskResult> {
  await requireAccess();
  if (!cleanQuestion(question)) return { status: "empty" };
  const visitor = await currentVisitor();
  const message = await rateLimitMessage(visitor);
  if (message) {
    return {
      status: "limited",
      sessionId: await latestAnsweredSessionId(),
      message,
    };
  }
  return { status: "started", sessionId: await createAskSession(visitor.hash) };
}
