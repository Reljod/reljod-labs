import type { Metadata } from "next";
import { Suspense } from "react";
import { ComplianceBar } from "@/features/document-compliance/components/demo-nav";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import {
  RunScreen,
  RunSkeleton,
} from "@/features/document-compliance/components/run/run-screen";
import { isRunId } from "@/features/document-compliance/domain/api";
import { initialFor } from "@/features/document-compliance/server/initial";
import { NotFoundError } from "@/platform/errors";

/** A run that is missing or someone else's shows as not found; any other failure is logged. */
function nullIfNotFound(error: unknown): null {
  if (error instanceof NotFoundError) return null;
  throw error;
}

export const metadata: Metadata = {
  title: "Pre-screen run · Document compliance checks",
};

export default function PrescreenRunPage({
  params,
}: PageProps<"/demos/document-compliance/runs/[runId]">) {
  return (
    <>
      <ComplianceBar />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <QueryProvider>
          <Suspense fallback={<RunSkeleton />}>
            <Run params={params} />
          </Suspense>
        </QueryProvider>
      </main>
    </>
  );
}

async function Run({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  // The run and the Session's runs come with the page, read side by side.
  const initial = await initialFor("the run", (services, owner) =>
    Promise.all([
      isRunId(runId)
        ? services.runs.get(owner, runId).catch(nullIfNotFound)
        : null,
      services.runs.list(owner),
    ]),
  );
  return (
    <RunScreen
      runId={runId}
      initialRun={initial?.[0]}
      initialRuns={initial?.[1]}
    />
  );
}
