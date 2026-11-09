import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AboutSections } from "@/components/sections/about-sections";
import { AskScreen } from "@/features/ledger/components/ask-screen";
import { loadAskSession } from "@/features/ledger/server/repository";

export const metadata: Metadata = {
  title: "Ask Ledger",
  description: "Ledger the cat banker rebuilds Reljod's site into an answer.",
  robots: { index: false },
};

export default function AskSessionPage({
  params,
  searchParams,
}: PageProps<"/ask/[sessionId]">) {
  return (
    <Suspense
      fallback={
        <p className="eyebrow p-6 text-ink-muted">Opening the books…</p>
      }
    >
      <Session params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Session({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  const session = await loadAskSession(sessionId);
  if (!session) notFound();
  return (
    <AskScreen
      session={session}
      initialQuestion={typeof query.ask === "string" ? query.ask : null}
      limited={query.notice === "limited"}
      pageCopy={<AboutSections />}
    />
  );
}
