import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireOwner } from "@/features/access/server/gate";
import { SwitchboardSkeleton } from "@/features/switchboard/components/skeleton";
import { Switchboard } from "@/features/switchboard/components/switchboard";
import type { FirstView } from "@/features/switchboard/domain/api";
import { switchboard } from "@/features/switchboard/server/container";
import { currentRequest } from "@/platform/request/current";

export const metadata: Metadata = {
  title: "Switchboard · Demo",
  description:
    "The phone line of a fictional railway, answered by a voice agent you can interrupt: realtime speech to speech, tools through one MCP server, and Rules checked by code at every tool call.",
};

/*
 * The Owner's Back office, Rules and Calls come from the request's cookies,
 * so they are read behind Suspense and handed down, through the same service
 * the state route uses. The Access gate runs in `src/proxy.ts`, here, and
 * again in every route. Nothing plays and no microphone is asked for until a
 * button is pressed.
 */
export default function SwitchboardDemoPage() {
  return (
    <Suspense fallback={<SwitchboardSkeleton />}>
      <SwitchboardWithData />
    </Suspense>
  );
}

async function SwitchboardWithData() {
  let initial: FirstView | null = null;
  try {
    const [{ owner }, { mode, visitor }] = await Promise.all([
      requireOwner(),
      currentRequest(),
    ]);
    const services = switchboard(mode);
    await services.office.ensure(owner);
    initial = await services.office.firstView({ owner, visitor });
  } catch (error) {
    // Next's own signals pass; without Access the client's reads say why.
    unstable_rethrow(error);
  }
  return <Switchboard initial={initial} />;
}
