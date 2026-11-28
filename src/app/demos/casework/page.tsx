import type { Metadata } from "next";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { AccessDeniedError, requireOwner } from "@/features/access/server/gate";
import { Desk } from "@/features/casework/components/desk";
import { DeskSkeleton } from "@/features/casework/components/skeletons";
import { SESSION_COOKIE } from "@/features/casework/server/api";
import { casework } from "@/features/casework/server/container";
import type { DeskView } from "@/features/casework/view";
import { currentRequest } from "@/platform/request/current";

export const metadata: Metadata = {
  title: "Teller · Demo",
  description:
    "A specialist agent that runs pension withdrawal, employer onboarding, structure and screening reviews as durable pipelines of reusable jobs, exposed over MCP.",
};

/**
 * The desk's first view is read on the server, through the same service as
 * `PUT /api/casework/desk`, and streams in with the page, so it paints with
 * its data and no request from the browser. It reads the Owner's cookies, so
 * it sits behind Suspense (`cacheComponents` is on).
 */
export default function CaseworkDemoPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <LoadedDesk />
    </Suspense>
  );
}

/**
 * Null when the Owner has no Desk yet (creating one is a write, left to the
 * desk's first `PUT`), when the gate refuses (that request reports it) or
 * when a read fails (that request retries).
 */
async function initialDesk(): Promise<DeskView | null> {
  try {
    const [{ owner }, { mode }, jar] = await Promise.all([
      requireOwner(),
      currentRequest(),
      cookies(),
    ]);
    const services = casework(mode);
    const remembered = jar.get(SESSION_COOKIE)?.value ?? null;
    const desk = await services.desks.current(owner, remembered);
    return desk ? await services.desks.view(owner, desk) : null;
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof AccessDeniedError))
      console.error("[casework] first view", error);
    return null;
  }
}

async function LoadedDesk() {
  return <Desk initial={await initialDesk()} />;
}
