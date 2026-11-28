import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireOwner } from "@/features/access/server/gate";
import { Sieve } from "@/features/name-extraction/components/sieve";
import { SieveSkeleton } from "@/features/name-extraction/components/skeletons";
import type { CorpusCard } from "@/features/name-extraction/domain/contract";
import { corpusCards } from "@/features/name-extraction/domain/corpus";
import { sieve } from "@/features/name-extraction/server/container";
import type { FirstView } from "@/features/name-extraction/server/services";
import { currentRequest } from "@/platform/request/current";

export const metadata: Metadata = {
  title: "Sieve · Demo",
  description:
    "One agent with tools finds every party a 10 to 500 page AML document names, with every alias and page: parallel Reader sub-agents, Skills on demand, code in a sandbox, and a Done gate that will not let it stop early.",
};

/*
 * The demo Documents are seed data, built into the static shell. The
 * Owner's Runs and Rulebook come from the request's cookies, so they are
 * read behind Suspense (`cacheComponents` is on), through the same services
 * the REST routes use, and handed to Sieve, which does not ask for them
 * again on mount. The Access gate runs in `src/proxy.ts`, here, and again in
 * every route.
 */
export default function NameExtractionDemoPage() {
  const corpus = corpusCards();
  return (
    <Suspense fallback={<SieveSkeleton />}>
      <SieveWithData corpus={corpus} />
    </Suspense>
  );
}

async function SieveWithData({ corpus }: { corpus: CorpusCard[] }) {
  let view: FirstView = { runs: null, rulebooks: null };
  try {
    const [{ owner }, { mode }] = await Promise.all([
      requireOwner(),
      currentRequest(),
    ]);
    view = await sieve(mode).firstView(owner);
  } catch (error) {
    // Next's own signals pass; without Access the client's reads say why.
    unstable_rethrow(error);
  }
  return (
    <Sieve
      corpus={corpus}
      initialRuns={view.runs}
      initialRulebooks={view.rulebooks}
    />
  );
}
