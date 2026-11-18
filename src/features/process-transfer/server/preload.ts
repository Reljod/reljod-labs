import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AccessDeniedError, requireOwner } from "@/features/access/server/gate";
import type { Loaded } from "../domain/api";
import type { DeskView, RunView } from "../domain/run";
import { readDesk, readRun } from "./reads";

/*
 * The page's first reads, made while the page renders on the server, in
 * parallel, so the Desk (and a Run in the address) arrive with the page
 * instead of after it hydrates. A failure is a value, not a
 * throw: the browser shows it with a Try again.
 */

async function settle<T>(
  work: Promise<T>,
  fallback: string,
): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    console.error("[process-transfer]", error);
    return { ok: false, error: fallback };
  }
}

export async function preloadHandover(runId: string | null): Promise<{
  desk: Loaded<DeskView>;
  run: Loaded<RunView | null> | null;
}> {
  const gate = requireOwner();
  // Both reads wait on the one gate; a refusal settles each of them.
  gate.catch(() => {});
  const [desk, run] = await Promise.all([
    settle(
      gate.then(({ access, owner }) => readDesk(access, owner)),
      "The demo could not load your Runs and Rules.",
    ),
    runId
      ? settle(
          gate.then(({ owner }) => readRun(owner, runId)),
          "The Run could not be loaded.",
        )
      : null,
  ]);
  return { desk, run };
}
