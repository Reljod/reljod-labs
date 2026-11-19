import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireOwner } from "@/features/access/server/gate";
import { Operator } from "@/features/operator/components/operator";
import { OperatorSkeleton } from "@/features/operator/components/skeletons";
import type { TaskCard } from "@/features/operator/domain/contract";
import { taskCards } from "@/features/operator/domain/task-cards";
import { initialView } from "@/features/operator/server/reads";

export const metadata: Metadata = {
  title: "Operator · Demo",
  description:
    "An agent that works a system nobody can integrate with: it looks at a green-screen terminal and keys a cargo manifest with the keyboard and mouse while you watch. Rules decide which keys need a person, and code checks the result.",
};

/*
 * The sample Tasks are seed data, built into the static shell. The Owner's
 * Runs and Rulebook come from the request's cookies, so they are read behind
 * Suspense (`cacheComponents` is on) and handed to the Operator screen,
 * which does not ask for them again on mount. The Access gate runs in
 * `src/proxy.ts`, here, and again in every route and server action.
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
  let view: Awaited<ReturnType<typeof initialView>> = {
    runs: null,
    rulebooks: null,
  };
  try {
    const { owner } = await requireOwner();
    view = await initialView(owner);
  } catch (error) {
    // Next's own signals pass; without Access the client's reads say why.
    unstable_rethrow(error);
  }
  return (
    <Operator
      tasks={tasks}
      initialRuns={view.runs}
      initialRulebooks={view.rulebooks}
    />
  );
}
