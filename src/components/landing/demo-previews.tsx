import type { ReactNode } from "react";
import { CaseworkPreview } from "@/components/showcase/previews/casework-preview";
import { ClientManagerPreview } from "@/components/showcase/previews/client-manager-preview";
import { DocumentCompliancePreview } from "@/components/showcase/previews/document-compliance-preview";
import { HarnessPreview } from "@/components/showcase/previews/harness-preview";
import { LedgerPreview } from "@/components/showcase/previews/ledger-preview";
import { OperatorPreview } from "@/components/showcase/previews/operator-preview";
import { ProcessTransferPreview } from "@/components/showcase/previews/process-transfer-preview";
import { SievePreview } from "@/components/showcase/previews/sieve-preview";
import type { Project } from "@/content/types";

/** Each live demo's moving preview, by project slug. `landing.test.ts` checks every live demo has one. */
export const demoPreviews: Record<string, (project: Project) => ReactNode> = {
  "document-compliance-checks": (project) => (
    <DocumentCompliancePreview project={project} />
  ),
  ledger: () => <LedgerPreview />,
  "casework-desk": () => <CaseworkPreview />,
  "client-manager": () => <ClientManagerPreview />,
  "process-transfer": () => <ProcessTransferPreview />,
  "bank-harness": () => <HarnessPreview />,
  "name-extraction": () => <SievePreview />,
  operator: () => <OperatorPreview />,
};
