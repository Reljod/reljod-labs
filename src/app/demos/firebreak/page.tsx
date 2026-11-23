import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireAccess } from "@/features/access/server/gate";
import { Firebreak } from "@/features/firebreak/components/firebreak";
import { FirebreakSkeleton } from "@/features/firebreak/components/skeleton";
import type { Allowance } from "@/features/firebreak/domain/api";
import { LIMITS } from "@/features/firebreak/domain/limits";
import { env } from "@/features/firebreak/server/env";
import { turnsUsed, visitor } from "@/features/firebreak/server/rate";

export const metadata: Metadata = {
  title: "Firebreak · Demo",
  description:
    "A 72-hour crisis drill for chief executives: Qwen4-Max plays the regulator, the press, the staff and the board; code keeps the score, the clock and the law.",
};

/*
 * The Scenarios are static. The visitor's allowance comes from the request,
 * so it is read behind Suspense and handed down. The Access gate runs in
 * `src/proxy.ts`, here, and again in every route.
 */
export default function FirebreakDemoPage() {
  return (
    <Suspense fallback={<FirebreakSkeleton />}>
      <FirebreakWithData />
    </Suspense>
  );
}

async function FirebreakWithData() {
  let initial: Allowance | null = null;
  try {
    const [, who] = await Promise.all([requireAccess(), visitor()]);
    initial = {
      used: await turnsUsed(who),
      perHour: LIMITS.turnsPerHour,
      model: env.model(),
    };
  } catch (error) {
    // Next's own signals pass; without Access (or before the migration) the routes say why.
    unstable_rethrow(error);
  }
  return <Firebreak initialAllowance={initial} />;
}
