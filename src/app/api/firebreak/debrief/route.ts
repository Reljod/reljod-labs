import { headers } from "next/headers";
import { requireAccess } from "@/features/access/server/gate";
import {
  type DebriefEvent,
  debriefRequestSchema,
  STUB_HEADER,
} from "@/features/firebreak/domain/api";
import { prepareDebrief, runDebrief } from "@/features/firebreak/server/drill";
import { env } from "@/features/firebreak/server/env";
import { take, visitor } from "@/features/firebreak/server/rate";
import { failure, ndjson } from "@/features/firebreak/server/respond";

export const maxDuration = 300;

/**
 * The After-Action Review: code grades the finished drill, then the Comms
 * lead drafts the public Statement and revises it against code's checks.
 */
export async function POST(request: Request) {
  try {
    const [, who, body, requestHeaders] = await Promise.all([
      requireAccess(),
      visitor(),
      request.json().catch(() => ({})),
      headers(),
    ]);
    const prepared = prepareDebrief(debriefRequestSchema.parse(body));
    const bypass = env.e2eBypassToken();
    const stub =
      who.trusted &&
      Boolean(bypass) &&
      requestHeaders.get(STUB_HEADER) === bypass;
    await take(who, "debrief");
    return await ndjson<DebriefEvent>(
      runDebrief(prepared, { stub, signal: request.signal }),
      request.signal,
      () => ({
        t: "error",
        message: "The Review stopped partway. Try it again.",
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
