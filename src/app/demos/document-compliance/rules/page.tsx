import type { Metadata } from "next";
import {
  ComplianceBar,
  DemoHeader,
} from "@/features/document-compliance/components/demo-nav";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { RulebookEditor } from "@/features/document-compliance/components/rules/rulebook-editor";

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
        <RulebookEditor />
      </main>
    </QueryProvider>
  );
}
