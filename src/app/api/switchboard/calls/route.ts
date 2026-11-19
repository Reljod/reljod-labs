import { headers } from "next/headers";
import { z } from "zod";
import {
  type CallsResponse,
  STUB_HEADER,
  type StartCallResponse,
} from "@/features/switchboard/domain/api";
import { scenarioSchema } from "@/features/switchboard/domain/contract";
import {
  endCall,
  loadCall,
  startCall,
} from "@/features/switchboard/server/calls";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { StateError } from "@/features/switchboard/server/errors";
import { greet } from "@/features/switchboard/server/line";
import { bodyOf, failure, json } from "@/features/switchboard/server/respond";
import { grantSession } from "@/features/switchboard/server/session";
import { listCalls } from "@/features/switchboard/server/store";

const startSchema = z.object({
  line: z.enum(["voice", "text"]),
  model: z.string().max(120).optional(),
  scenario: scenarioSchema,
});

/** The Owner's saved Calls, newest first. */
export async function GET() {
  try {
    const { owner } = await requireWorkspace();
    return json<CallsResponse>({ calls: await listCalls(owner) });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Starts a Call. The voice Line answers with what opens the realtime
 * Session; the text Line with the Agent's greeting already said.
 */
export async function POST(request: Request) {
  try {
    const { owner, who } = await requireWorkspace();
    const body = startSchema.parse(await bodyOf(request));
    const stub = who.trusted && (await headers()).get(STUB_HEADER) === "1";
    const call = await startCall({
      owner,
      who,
      line: body.line,
      origin: "app",
      model: body.model,
      scenario: body.scenario,
      consentAudio: false,
      stub,
    });
    let session: StartCallResponse["session"] = null;
    if (call.line === "voice") {
      try {
        session = await grantSession(call);
      } catch (error) {
        console.error(
          "[switchboard] session mint failed",
          error instanceof Error ? error.message : "",
        );
        await endCall({
          owner,
          callId: call.id,
          by: "client",
          reason: "The Session could not open.",
        });
        throw new StateError(
          "The voice Line could not open. Try the text Line, or try again.",
        );
      }
    } else {
      await greet(owner, call.id);
    }
    const loaded = await loadCall(owner, call.id);
    return json<StartCallResponse>({ ...loaded, session });
  } catch (error) {
    return failure(error);
  }
}
