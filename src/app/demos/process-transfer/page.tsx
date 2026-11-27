import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireOwner } from "@/features/access/server/gate";
import { HandoverSkeleton } from "@/features/process-transfer/components/desk-skeleton";
import { Handover } from "@/features/process-transfer/components/handover";
import { parseTab } from "@/features/process-transfer/components/tabs";
import {
  type Loaded,
  parseRunId,
} from "@/features/process-transfer/domain/api";
import { handover } from "@/features/process-transfer/server/container";
import { isAppError } from "@/platform/errors";
import { currentRequest } from "@/platform/request/current";

export const metadata: Metadata = {
  title: "Handover · Demo",
  description:
    "A recorded handover call becomes a written process with every step linked to the recording, a workflow document and a slide deck that is only approved once its checks pass.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The shell is static; the tab and the open Run come from the address, which
 * is request data, so they are read behind Suspense (`cacheComponents` is on).
 * The Desk and the Run in the address are read here too, in parallel and
 * through the same services as the REST routes, so the first view needs no
 * request from the browser; until they land the fallback shows the Desk's
 * shape. The Access gate runs in `src/proxy.ts`, once here, and again in
 * every route.
 */
export default function ProcessTransferPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<HandoverSkeleton />}>
      <App searchParams={searchParams} />
    </Suspense>
  );
}

/** A first read as a value, not a throw: the browser shows a failure with a Try again. */
async function settle<T>(
  work: Promise<T>,
  fallback: string,
): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) return { ok: false, error: error.message };
    console.error("[process-transfer]", error);
    return { ok: false, error: fallback };
  }
}

async function App({ searchParams }: { searchParams: SearchParams }) {
  const { tab, run } = await searchParams;
  const initialTab = parseTab(tab);
  const initialRunId = parseRunId(run);
  // A Run in the address is shown only on the Convert tab; elsewhere it is
  // read when the person goes there.
  const openRunId = initialTab === "convert" ? initialRunId : null;
  const gate = Promise.all([requireOwner(), currentRequest()]).then(
    ([{ owner }, { mode, visitor }]) => ({
      services: handover(mode),
      owner,
      visitor,
    }),
  );
  // Both reads wait on the one gate; a refusal settles each of them.
  gate.catch(() => {});
  const [desk, initialRun] = await Promise.all([
    settle(
      gate.then(({ services, owner, visitor }) =>
        services.runs.desk({ owner, visitor }),
      ),
      "The demo could not load your Runs and Rules.",
    ),
    openRunId
      ? settle(
          gate.then(({ services, owner }) =>
            services.runs.run(owner, openRunId).catch((error) => {
              // Not this Owner's (or gone): the screen says so, not an error.
              if (isAppError(error) && error.status === 404) return null;
              throw error;
            }),
          ),
          "The Run could not be loaded.",
        )
      : null,
  ]);
  return (
    <Handover
      initialTab={initialTab}
      initialRunId={initialRunId}
      initialDesk={desk}
      initialRun={initialRun}
    />
  );
}
