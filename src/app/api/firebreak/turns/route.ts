import { headers } from "next/headers";
import { requireAccess } from "@/features/access/server/gate";
import {
  STUB_HEADER,
  type TurnEvent,
  turnRequestSchema,
} from "@/features/firebreak/domain/api";
import { prepareTurn, runTurn } from "@/features/firebreak/server/drill";
import { env } from "@/features/firebreak/server/env";
import { take, visitor } from "@/features/firebreak/server/rate";
import { failure, ndjson } from "@/features/firebreak/server/respond";

export const maxDuration = 150;

/**
 * One Round of a drill: the Engine plays the decision, the Room answers, and
 * the next Inject is chosen. The gate, the request, the replay of every Round
 * so far and the rate are all checked before the model is called; after
 * that, a failure is an `error` line in the stream.
 */
export async function POST(request: Request) {
  try {
    const [, who, body, requestHeaders] = await Promise.all([
      requireAccess(),
      visitor(),
      request.json().catch(() => ({})),
      headers(),
    ]);
    const prepared = prepareTurn(turnRequestSchema.parse(body));
    const bypass = env.e2eBypassToken();
    const stub =
      who.trusted &&
      Boolean(bypass) &&
      requestHeaders.get(STUB_HEADER) === bypass;
    await take(who, "turn");
    return await ndjson<TurnEvent>(
      runTurn(prepared, { stub, signal: request.signal }),
      request.signal,
      () => ({
        t: "error",
        message: "The Room went quiet partway. Try the Round again.",
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
