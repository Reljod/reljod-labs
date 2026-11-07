import type { Metadata } from "next";
import { Suspense } from "react";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import {
  RunScreen,
  RunSkeleton,
} from "@/features/document-compliance/components/run/run-screen";

export const metadata: Metadata = {
  title: "Pre-screen run · Document compliance checks",
};

export default function PrescreenRunPage({
  params,
}: PageProps<"/demos/document-compliance/runs/[runId]">) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <QueryProvider>
        <Suspense fallback={<RunSkeleton />}>
          <Run params={params} />
        </Suspense>
      </QueryProvider>
    </main>
  );
}

async function Run({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunScreen runId={runId} />;
}
