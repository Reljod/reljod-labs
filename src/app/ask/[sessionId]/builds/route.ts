import { cleanQuestion } from "@/features/ledger/domain/presets";
import { loadAskSession } from "@/features/ledger/server/repository";
import { runBuild } from "@/features/ledger/server/run-build";
import { currentVisitor } from "@/features/ledger/server/visitor";

export const maxDuration = 120;

/** Plans the next Build of an Ask session, streamed as newline-delimited JSON. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
  } | null;
  const question = cleanQuestion(String(body?.question ?? ""));
  if (!question) return new Response("Ask a question", { status: 400 });

  const session = await loadAskSession(sessionId);
  if (!session) return new Response("Not found", { status: 404 });

  const events = runBuild({
    session,
    question,
    visitor: await currentVisitor(),
  });
  return new Response(events, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
