import type { Metadata } from "next";
import Link from "next/link";
import { PrescreenDemo } from "@/features/document-compliance/components/prescreen-demo";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { packs } from "@/features/document-compliance/packs";

// A live run parses three documents and calls the model; allow Vercel's Hobby maximum.
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Document compliance checks · Demo",
  description:
    "AI pre-screening of onboarding documents, with every finding traced back to a box on the source document.",
};

export default function DocumentComplianceDemoPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-4">
        <Link href="/" className="eyebrow text-federal-blue underline">
          ← Back to Reljod Labs
        </Link>
        <p className="eyebrow text-ink-muted">Live demo</p>
        <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
          Document compliance checks
        </h1>
        <p className="max-w-3xl text-lg text-ink-muted">
          Pick a synthetic onboarding pack and run an AI Pre-screen against an
          individual onboarding Rulebook. Parsers find the text and its
          position, the model reads fields only as references to that text, and
          code decides each Finding. A person still makes every decision.
        </p>
        <p className="max-w-3xl text-sm text-ink-muted">
          Every document is a specimen from the fictional Republic of Meridia.
          No real person, issuer or document design is shown.
        </p>
      </header>
      <QueryProvider>
        <PrescreenDemo
          packs={packs.map(({ slug, title, flaw }) => ({ slug, title, flaw }))}
        />
      </QueryProvider>
    </main>
  );
}
