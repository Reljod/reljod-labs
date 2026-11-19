import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireOwner } from "@/features/access/server/gate";
import { Loupe, LoupeSkeleton } from "@/features/loupe/components/loupe";
import type { SampleCard } from "@/features/loupe/domain/contract";
import {
  MANIFEST,
  RECORDED,
  sampleCards,
} from "@/features/loupe/domain/corpus";
import { DEFAULT_RULEBOOK } from "@/features/loupe/domain/rules";
import { type Calibration, calibrate } from "@/features/loupe/domain/score";
import { initialView } from "@/features/loupe/server/reads";

export const metadata: Metadata = {
  title: "Loupe · Demo",
  description:
    "A forensic examiner for documents: one agent looks at a payslip, a statement, an invoice or an ID, tests what it suspects with code in a sandbox, and Rules decide whether it was tampered with. Evidence for a human reviewer.",
};

/*
 * The Samples and the Default Rulebook's Calibration are seed data, built
 * into the static shell. The Owner's Examinations and Rulebook versions come
 * from the request's cookies, so they are read behind Suspense
 * (`cacheComponents` is on) and handed to Loupe, which does not ask for them
 * again on mount. The Access gate runs in `src/proxy.ts`, here, and again in
 * every route and server action.
 */
export default function LoupeDemoPage() {
  const samples = sampleCards();
  const calibration = calibrate(MANIFEST, RECORDED, DEFAULT_RULEBOOK);
  return (
    <Suspense fallback={<LoupeSkeleton />}>
      <LoupeWithData samples={samples} calibration={calibration} />
    </Suspense>
  );
}

async function LoupeWithData({
  samples,
  calibration,
}: {
  samples: SampleCard[];
  calibration: Calibration;
}) {
  let view: {
    examinations:
      | Awaited<ReturnType<typeof initialView>>["examinations"]
      | null;
    rulebooks: Awaited<ReturnType<typeof initialView>>["rulebooks"] | null;
  } = { examinations: null, rulebooks: null };
  try {
    const { owner } = await requireOwner();
    view = await initialView(owner);
  } catch (error) {
    // Next's own signals pass; without Access the client's reads say why.
    unstable_rethrow(error);
  }
  return (
    <Loupe
      samples={samples}
      calibration={calibration}
      initialExaminations={view.examinations}
      initialRulebooks={view.rulebooks}
    />
  );
}
