import type { Metadata } from "next";
import { Suspense } from "react";
import { Handover } from "@/features/process-transfer/components/handover";
import { parseTab } from "@/features/process-transfer/components/tabs";

export const metadata: Metadata = {
  title: "Handover · Demo",
  description:
    "A recorded handover call becomes a written process with every step linked to the recording, a workflow document and a slide deck that is only approved once its checks pass.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The shell is static; the tab and the open Run come from the address, which
 * is request data, so they are read behind Suspense (`cacheComponents` is on).
 * The Access gate runs in `src/proxy.ts` and again in every server action.
 */
export default function ProcessTransferPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<div className="h-dvh bg-marble" />}>
      <App searchParams={searchParams} />
    </Suspense>
  );
}

async function App({ searchParams }: { searchParams: SearchParams }) {
  const { tab, run } = await searchParams;
  const initialTab = parseTab(tab);
  const initialRunId = typeof run === "string" && UUID.test(run) ? run : null;
  return <Handover initialTab={initialTab} initialRunId={initialRunId} />;
}
