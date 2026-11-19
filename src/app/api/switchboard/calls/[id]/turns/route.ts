import { z } from "zod";
import type { TurnStreamPart } from "@/features/switchboard/domain/contract";
import { LIMITS } from "@/features/switchboard/domain/limits";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { takeTurn } from "@/features/switchboard/server/line";
import {
  bodyOf,
  failure,
  NDJSON_HEADERS,
} from "@/features/switchboard/server/respond";

// A Turn may take up to `LIMITS.stepsPerTurn` model steps and tool calls.
export const maxDuration = 120;

const schema = z.object({ text: z.string().min(1).max(LIMITS.turnChars) });

/**
 * One typed Caller Turn on the text Line, answered as NDJSON
 * `TurnStreamPart`s. Refusals before the first line (no Access, a limit, a
 * Call that is over) are JSON errors.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/switchboard/calls/[id]/turns">,
) {
  let turn: AsyncGenerator<TurnStreamPart>;
  let first: IteratorResult<TurnStreamPart>;
  try {
    const { owner, who } = await requireWorkspace();
    const { id } = await params;
    const body = schema.parse(await bodyOf(request));
    turn = takeTurn({
      owner,
      who,
      callId: id,
      text: body.text,
      via: "text",
      signal: request.signal,
    });
    // Everything that refuses the Turn happens before its first line.
    first = await turn.next();
  } catch (error) {
    return failure(error);
  }
  const encoder = new TextEncoder();
  const line = (part: TurnStreamPart) =>
    encoder.encode(`${JSON.stringify(part)}\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(line(first.value));
        for await (const part of turn) controller.enqueue(line(part));
      } catch {
        controller.enqueue(
          line({
            kind: "error",
            message: "The Agent could not answer. Try that again.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}
