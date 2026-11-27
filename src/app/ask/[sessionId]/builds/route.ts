import { ownerOf } from "@/features/access/domain/owner";
import { accessOrDenied } from "@/features/access/server/gate";
import { cleanQuestion } from "@/features/ledger/domain/presets";
import { takeBuildRate } from "@/features/ledger/server/rate-limit";
import { loadAskSession } from "@/features/ledger/server/repository";
import { runBuild } from "@/features/ledger/server/run-build";
import { currentVisitor } from "@/features/ledger/server/visitor";

export const maxDuration = 120;

/** Plans the next Build of an Ask session, streamed as newline-delimited JSON. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const [access, { sessionId }] = await Promise.all([accessOrDenied(), params]);
  if (access instanceof Response) return access;
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
  } | null;
  const question = cleanQuestion(String(body?.question ?? ""));
  if (!question) return new Response("Ask a question", { status: 400 });

  // The rate hit is taken while the session loads, before any model call;
  // the stream reads it first.
  const visiting = currentVisitor();
  const limit = visiting.then(takeBuildRate);
  limit.catch(() => {}); // Read (and reported) by the stream; unread on a 404.

  // Another Owner's session is answered as if it did not exist.
  const owner = ownerOf(access);
  const [session, visitor] = await Promise.all([
    loadAskSession(sessionId, owner),
    visiting,
  ]);
  if (!session) return new Response("Not found", { status: 404 });

  const events = runBuild({ session, owner, question, visitor, limit });
  return new Response(events, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
