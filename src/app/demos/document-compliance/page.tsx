import type { Metadata } from "next";
import { Caveats } from "@/features/document-compliance/components/caveats";
import { DemoHeader } from "@/features/document-compliance/components/demo-nav";
import { PackPicker } from "@/features/document-compliance/components/pack-picker";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { SessionRuns } from "@/features/document-compliance/components/session-runs";
import { packs } from "@/features/document-compliance/packs";

export const metadata: Metadata = {
  title: "Document compliance checks · Demo",
  description:
    "AI pre-screening of onboarding documents, with every finding traced back to a box on the source document.",
};

export default function DocumentComplianceDemoPage() {
  return (
    <QueryProvider>
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12 lg:h-dvh lg:min-h-[44rem] lg:gap-6 lg:py-8">
        <DemoHeader current="packs" title="Document compliance checks" />
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
        <SessionRuns />
      </div>
    </QueryProvider>
  );
}
