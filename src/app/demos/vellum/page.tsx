import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireAccess } from "@/features/access/server/gate";
import { VellumSkeleton } from "@/features/vellum/components/skeleton";
import { Vellum } from "@/features/vellum/components/vellum";
import type { Allowance } from "@/features/vellum/domain/api";
import { LIMITS } from "@/features/vellum/domain/limits";
import { env } from "@/features/vellum/server/env";
import { passesUsed, visitor } from "@/features/vellum/server/rate";

export const metadata: Metadata = {
  title: "Vellum · Demo",
  description:
    "Hand GPT-6.2 Astra a screenshot and watch it redraw the screen as vector marks, mark by mark; code renders the drawing, measures it against the pixels and sends it back for another pass.",
};

/*
 * The Samples are static. The visitor's allowance comes from the request, so
 * it is read behind Suspense and handed down. The Access gate runs in
 * `src/proxy.ts`, here, and again in every route.
 */
export default function VellumDemoPage() {
  return (
    <Suspense fallback={<VellumSkeleton />}>
      <VellumWithData />
    </Suspense>
  );
}

async function VellumWithData() {
  let initial: Allowance | null = null;
  try {
    const [, who] = await Promise.all([requireAccess(), visitor()]);
    initial = {
      used: await passesUsed(who),
      perHour: LIMITS.passesPerHour,
      model: env.model(),
    };
  } catch (error) {
    // Next's own signals pass; without Access (or before the migration) the client's reads say why.
    unstable_rethrow(error);
  }
  return <Vellum initialAllowance={initial} />;
}
