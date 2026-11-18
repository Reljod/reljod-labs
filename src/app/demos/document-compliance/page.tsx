import type { Metadata } from "next";
import { Suspense } from "react";
import { Caveats } from "@/features/document-compliance/components/caveats";
import {
  ComplianceBar,
  DemoHeader,
} from "@/features/document-compliance/components/demo-nav";
import { PackPicker } from "@/features/document-compliance/components/pack-picker";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { SessionRuns } from "@/features/document-compliance/components/session-runs";
import { packs } from "@/features/document-compliance/packs";
import { initialFor } from "@/features/document-compliance/server/initial";
import { listOwnerRuns } from "@/features/document-compliance/server/repository";

export const metadata: Metadata = {
  title: "Document compliance checks · Demo",
  description:
    "AI pre-screening of onboarding documents, with every finding traced back to a box on the source document.",
};

export default function DocumentComplianceDemoPage() {
  return (
    <QueryProvider>
      <ComplianceBar current="packs" />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12 lg:h-[calc(100dvh-4rem)] lg:min-h-[40rem] lg:gap-6 lg:py-8">
        <DemoHeader title="Document compliance checks" />
        <PackPicker
          packs={packs.map(({ slug, title, documents }) => ({
            slug,
            title,
            documents,
          }))}
        />
        <Caveats />
      </main>
      {/* Below the fold: the runs this browser started, once there are any. */}
      <div className="mx-auto max-w-6xl px-4 pb-12 empty:hidden sm:px-6">
        <Suspense fallback={null}>
          <Runs />
        </Suspense>
      </div>
    </QueryProvider>
  );
}

/** Streams in after the pack picker, which is static and paints first. */
async function Runs() {
  const runs = await initialFor("the Session's runs", listOwnerRuns);
  return <SessionRuns initialRuns={runs} />;
}
