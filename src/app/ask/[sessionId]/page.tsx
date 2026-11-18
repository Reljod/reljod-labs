import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AboutSections } from "@/components/sections/about-sections";
import { ACCESS_PATH } from "@/features/access/constants";
import { ownerOf } from "@/features/access/domain/owner";
import { currentAccess } from "@/features/access/server/gate";
import { AskScreen } from "@/features/ledger/components/ask-screen";
import { AskScreenSkeleton } from "@/features/ledger/components/ask-screen-skeleton";
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
    // The fallback is the static shell: the bar, the About copy and Ledger's
    // desk paint before the session (access, Owner, Builds) is read.
    <Suspense fallback={<AskScreenSkeleton pageCopy={<AboutSections />} />}>
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
  const access = await currentAccess();
  if (!access) {
    redirect(`${ACCESS_PATH}?next=${encodeURIComponent(`/ask/${sessionId}`)}`);
  }
  // Only its Owner may open an Ask session; anyone else gets a 404.
  const session = await loadAskSession(sessionId, ownerOf(access));
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
