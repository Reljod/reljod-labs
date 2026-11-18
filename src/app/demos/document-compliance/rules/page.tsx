import type { Metadata } from "next";
import { Suspense } from "react";
import {
  ComplianceBar,
  DemoHeader,
} from "@/features/document-compliance/components/demo-nav";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import {
  RulebookEditor,
  RulebookSkeleton,
} from "@/features/document-compliance/components/rules/rulebook-editor";
import { initialFor } from "@/features/document-compliance/server/initial";
import { listRules } from "@/features/document-compliance/server/rules";

export const metadata: Metadata = {
  title: "Rules · Document compliance checks",
  description:
    "The Rules a Pre-screen applies, edited as sentences with typed Parameters and kept as Versions.",
};

export default function DocumentComplianceRulesPage() {
  return (
    <QueryProvider>
      <ComplianceBar current="rules" />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
        <DemoHeader title="Rules" />
        <Suspense fallback={<RulebookSkeleton />}>
          <Rulebook />
        </Suspense>
      </main>
    </QueryProvider>
  );
}

async function Rulebook() {
  const rules = await initialFor("the Rules", listRules);
  return <RulebookEditor initialRules={rules} />;
}
