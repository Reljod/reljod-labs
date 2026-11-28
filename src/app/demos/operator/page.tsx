import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireOwner } from "@/features/access/server/gate";
import { Operator } from "@/features/operator/components/operator";
import { OperatorSkeleton } from "@/features/operator/components/skeletons";
import type {
  RulebookVersion,
  RunSummary,
  TaskCard,
} from "@/features/operator/domain/contract";
import { taskCards } from "@/features/operator/domain/task-cards";
import { operator } from "@/features/operator/server/container";
import { currentRequest } from "@/platform/request/current";

export const metadata: Metadata = {
  title: "Operator · Demo",
  description:
    "An agent that works a system nobody can integrate with: it looks at a green-screen terminal and keys a cargo manifest with the keyboard and mouse while you watch. Rules decide which keys need a person, and code checks the result.",
};

/*
 * The sample Tasks are seed data, built into the static shell. The Owner's
 * Runs and Rulebook come from the request's cookies, so they are read behind
 * Suspense (`cacheComponents` is on), through the same services as the REST
 * routes, and handed to the Operator screen, which does not ask for them
 * again on mount. The Access gate runs in `src/proxy.ts`, here, and again in
 * every route.
 */
export default function OperatorDemoPage() {
  const tasks = taskCards();
  return (
    <Suspense fallback={<OperatorSkeleton />}>
      <OperatorWithData tasks={tasks} />
    </Suspense>
  );
}

async function OperatorWithData({ tasks }: { tasks: TaskCard[] }) {
  let runs: RunSummary[] | null = null;
  let rulebooks: RulebookVersion[] | null = null;
  try {
    const [{ owner }, { mode }] = await Promise.all([
      requireOwner(),
      currentRequest(),
    ]);
    const services = operator(mode);
    // A part that fails is left for the client to read again and explain.
    const [listed, versions] = await Promise.allSettled([
      services.runs.list(owner),
      services.rulebooks.versions(owner),
    ]);
    runs = listed.status === "fulfilled" ? listed.value : null;
    rulebooks = versions.status === "fulfilled" ? versions.value : null;
  } catch (error) {
    // Next's own signals pass; without Access the client's reads say why.
    unstable_rethrow(error);
  }
  return (
    <Operator tasks={tasks} initialRuns={runs} initialRulebooks={rulebooks} />
  );
}
