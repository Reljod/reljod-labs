import type { Metadata } from "next";
import { Suspense } from "react";
import { Desk } from "@/features/casework/components/desk";
import { DeskSkeleton } from "@/features/casework/components/skeletons";
import { initialDeskView } from "@/features/casework/server/desk-view";

export const metadata: Metadata = {
  title: "Teller · Demo",
  description:
    "A specialist agent that runs pension withdrawal, employer onboarding, structure and screening reviews as durable pipelines of reusable jobs, exposed over MCP.",
};

/**
 * The desk's first view is read on the server and streams in with the page,
 * so it paints with its data and no request from the browser. It reads the
 * Owner's cookies, so it sits behind Suspense (`cacheComponents` is on).
 */
export default function CaseworkDemoPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <LoadedDesk />
    </Suspense>
  );
}

async function LoadedDesk() {
  return <Desk initial={await initialDeskView()} />;
}
