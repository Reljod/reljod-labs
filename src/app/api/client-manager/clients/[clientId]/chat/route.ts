import { z } from "zod";
import {
  type ChatEvent,
  MAX_MESSAGE_LENGTH,
} from "@/features/client-manager/domain/events";
import { navigate } from "@/features/client-manager/server/navigator";
import {
  addMessage,
  getBuild,
  recentAsks,
} from "@/features/client-manager/server/repository";
import {
  checkLimits,
  createAddition,
  LimitError,
  startBuild,
  viewableClient,
} from "@/features/client-manager/server/service";
import {
  ensureSessionId,
  visitor,
} from "@/features/client-manager/server/session";

export const maxDuration = 120;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

/** One question to the Navigator, answered as newline-delimited JSON ChatEvents. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]/chat">,
) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { clientId } = await params;
  const sessionId = await ensureSessionId();
  const client = await viewableClient(clientId, sessionId);
  if (!client) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  const line = (event: ChatEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);
  const who = await visitor();
  try {
    await checkLimits(who, "ask");
  } catch (error) {
    if (!(error instanceof LimitError)) throw error;
    return new Response(line({ type: "error", message: error.message }), {
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  const question = parsed.data.text;
  const history = await recentAsks(client.id, sessionId);
  await addMessage({
    clientId: client.id,
    sessionId,
    role: "user",
    mode: "ask",
    content: question,
    visitorHash: who.hash,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const walk = navigate({
          context: {
            clientId: client.id,
            buildId: null,
            visitorHash: who.hash,
          },
          clientId: client.id,
          clientName: client.name,
          question,
          history,
          // Only the session that owns the client may add to it.
          onRecord:
            client.session_id === sessionId || (client.is_sample && who.trusted)
              ? async (facts) => {
                  const { buildId } = await createAddition(
                    client,
                    { note: facts, files: [] },
                    who,
                    sessionId,
                    false,
                  );
                  const build = await getBuild(buildId);
                  if (build) await startBuild(build, who);
                  return buildId;
                }
              : undefined,
        });
        let next = await walk.next();
        while (!next.done) {
          controller.enqueue(line(next.value));
          next = await walk.next();
        }
        const { text, reasoning, trace, cited, buildId } = next.value;
        const messageId = await addMessage({
          clientId: client.id,
          sessionId,
          role: "assistant",
          mode: "ask",
          content:
            text ||
            (buildId
              ? "Adding that to the graph."
              : "I couldn't find anything on that in the graph."),
          traversal: {
            steps: trace,
            cited,
            reasoning: reasoning.slice(0, 4000),
          },
          buildId,
          visitorHash: who.hash,
        });
        controller.enqueue(line({ type: "done", messageId, cited }));
      } catch (error) {
        console.error("client-manager chat", error);
        controller.enqueue(
          line({
            type: "error",
            message: "The Navigator lost its way. Try asking again.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
