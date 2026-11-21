import { headers } from "next/headers";
import { requireOwner } from "@/features/access/server/gate";
import { askRequestSchema, STUB_HEADER } from "@/features/floorwalk/domain/api";
import { ask } from "@/features/floorwalk/server/ask";
import { env } from "@/features/floorwalk/server/env";
import { loadFootage } from "@/features/floorwalk/server/footage";
import { take, visitor } from "@/features/floorwalk/server/rate";
import { failure, json } from "@/features/floorwalk/server/respond";

export const maxDuration = 120;

/** Ask the footage a question; the answer comes with moments to jump to. */
export async function POST(request: Request) {
  try {
    const [{ owner }, who, body, requestHeaders] = await Promise.all([
      requireOwner(),
      visitor(),
      request.json().catch(() => ({})),
      headers(),
    ]);
    const { source, question } = askRequestSchema.parse(body);
    const footage = await loadFootage(
      source,
      owner,
      new URL(request.url).origin,
    );
    const bypass = env.e2eBypassToken();
    const stub =
      who.trusted &&
      Boolean(bypass) &&
      requestHeaders.get(STUB_HEADER) === bypass;
    await take("ask", who);
    return json(await ask(footage, question, { stub, signal: request.signal }));
  } catch (error) {
    return failure(error);
  }
}
