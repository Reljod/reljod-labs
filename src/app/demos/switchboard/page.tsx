import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { SwitchboardSkeleton } from "@/features/switchboard/components/skeleton";
import { Switchboard } from "@/features/switchboard/components/switchboard";
import type { FirstView } from "@/features/switchboard/domain/api";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { firstView } from "@/features/switchboard/server/views";

export const metadata: Metadata = {
  title: "Switchboard · Demo",
  description:
    "The phone line of a fictional railway, answered by a voice agent you can interrupt: realtime speech to speech, tools through one MCP server, and Rules checked by code at every tool call.",
};

/*
 * The Owner's Back office, Rules and Calls come from the request's cookies,
 * so they are read behind Suspense and handed down. The Access gate runs in
 * `src/proxy.ts`, here, and again in every route and server action. Nothing
 * plays and no microphone is asked for until a button is pressed.
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
    const { owner, who } = await requireWorkspace();
    initial = await firstView(owner, who);
  } catch (error) {
    // Next's own signals pass; without Access the client's reads say why.
    unstable_rethrow(error);
  }
  return <Switchboard initial={initial} />;
}
