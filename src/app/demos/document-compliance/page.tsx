import type { Metadata } from "next";
import Link from "next/link";
import { Caveats } from "@/features/document-compliance/components/caveats";
import { PackPicker } from "@/features/document-compliance/components/pack-picker";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { packs } from "@/features/document-compliance/packs";

export const metadata: Metadata = {
  title: "Document compliance checks · Demo",
  description:
    "AI pre-screening of onboarding documents, with every finding traced back to a box on the source document.",
};

export default function DocumentComplianceDemoPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        <Link href="/" className="eyebrow text-federal-blue underline">
          ← Reljod Labs
        </Link>
        <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
          Document compliance checks
        </h1>
      </header>
      <QueryProvider>
        <PackPicker
          packs={packs.map(({ slug, title, documents }) => ({
            slug,
            title,
            documents,
          }))}
        />
      </QueryProvider>
      <Caveats />
    </main>
  );
}
