import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireAccess } from "@/features/access/server/gate";
import { Floorwalk } from "@/features/floorwalk/components/floorwalk";
import { FloorwalkSkeleton } from "@/features/floorwalk/components/skeleton";
import type { Allowance } from "@/features/floorwalk/domain/api";
import { floorwalk } from "@/features/floorwalk/server/container";
import { currentRequest } from "@/platform/request/current";

export const metadata: Metadata = {
  title: "Floorwalk · Demo",
  description:
    "Gemini 4 Neon watches body-camera footage of a site walk and reports every broken Rule with the second and the spot; code checks each one, scores the site and writes the Fix list.",
};

/*
 * The Samples are static. The visitor's allowance comes from the request, so
 * it is read behind Suspense and handed down, through the same service the
 * allowance route uses. The Access gate runs in `src/proxy.ts`, here, and
 * again in every route.
 */
export default function FloorwalkDemoPage() {
  return (
    <Suspense fallback={<FloorwalkSkeleton />}>
      <FloorwalkWithData />
    </Suspense>
  );
}

async function FloorwalkWithData() {
  let initial: Allowance | null = null;
  try {
    const [, { mode, visitor }] = await Promise.all([
      requireAccess(),
      currentRequest(),
    ]);
    initial = await floorwalk(mode).allowance(visitor);
  } catch (error) {
    // Next's own signals pass; without Access (or before the migration) the page still plays the recordings.
    unstable_rethrow(error);
  }
  return <Floorwalk initialAllowance={initial} />;
}
