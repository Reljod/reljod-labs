import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AuditSkeleton,
  AuditTrail,
} from "@/features/document-compliance/components/audit/audit-trail";
import {
  ComplianceBar,
  DemoHeader,
} from "@/features/document-compliance/components/demo-nav";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { listAuditEvents } from "@/features/document-compliance/server/audit";
import { initialFor } from "@/features/document-compliance/server/initial";

export const metadata: Metadata = {
  title: "Audit trail · Document compliance checks",
  description:
    "Every Pre-screen, model call, Rule change, re-evaluation and Reviewer decision, in the order it happened.",
};

export default function DocumentComplianceAuditPage() {
  return (
    <QueryProvider>
      <ComplianceBar current="audit" />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
        <DemoHeader title="Audit trail" />
        <Suspense fallback={<AuditSkeleton withToolbar />}>
          <Trail />
        </Suspense>
      </main>
    </QueryProvider>
  );
}

async function Trail() {
  const page = await initialFor("the Audit trail", (owner) =>
    listAuditEvents(owner),
  );
  return <AuditTrail initialPage={page} />;
}
