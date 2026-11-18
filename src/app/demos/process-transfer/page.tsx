import type { Metadata } from "next";
import { Suspense } from "react";
import { HandoverSkeleton } from "@/features/process-transfer/components/desk-skeleton";
import { Handover } from "@/features/process-transfer/components/handover";
import { parseTab } from "@/features/process-transfer/components/tabs";
import { parseRunId } from "@/features/process-transfer/domain/api";
import { preloadHandover } from "@/features/process-transfer/server/preload";

export const metadata: Metadata = {
  title: "Handover · Demo",
  description:
    "A recorded handover call becomes a written process with every step linked to the recording, a workflow document and a slide deck that is only approved once its checks pass.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The shell is static; the tab and the open Run come from the address, which
 * is request data, so they are read behind Suspense (`cacheComponents` is on).
 * The Desk and the Run in the address are read here too, in parallel, so the
 * first view needs no request from the browser; until they land the
 * fallback shows the Desk's shape.
 * The Access gate runs in `src/proxy.ts` and again in every read and action.
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

async function App({ searchParams }: { searchParams: SearchParams }) {
  const { tab, run } = await searchParams;
  const initialTab = parseTab(tab);
  const initialRunId = parseRunId(run);
  // A Run in the address is shown only on the Convert tab; elsewhere it is
  // read when the person goes there.
  const preload = await preloadHandover(
    initialTab === "convert" ? initialRunId : null,
  );
  return (
    <Handover
      initialTab={initialTab}
      initialRunId={initialRunId}
      initialDesk={preload.desk}
      initialRun={preload.run}
    />
  );
}
