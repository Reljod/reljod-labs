import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireAccess } from "@/features/access/server/gate";
import { HelioStudio } from "@/features/helio/components/helio-studio";
import { HelioSkeleton } from "@/features/helio/components/skeleton";

export const metadata: Metadata = {
  title: "Helio · Demo",
  description:
    "Autonomous commercial product studio powered by Microsoft MAI Image 2.7 native RGBA layers & multi-reference relighting plus Google Gemini 4 Neon creative direction and brand-integrity vision audits.",
};

export default function HelioDemoPage() {
  return (
    <Suspense fallback={<HelioSkeleton />}>
      <HelioWithAccess />
    </Suspense>
  );
}

async function HelioWithAccess() {
  try {
    await requireAccess();
  } catch (error) {
    unstable_rethrow(error);
  }
  return <HelioStudio />;
}
