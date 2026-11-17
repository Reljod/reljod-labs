import "server-only";
import type { AuditAction, AuditEvent } from "../domain/run";
import { insertAudit } from "./repository";

export type AuditInput = {
  owner: string;
  action: AuditAction;
  runId: string | null;
  summary: string;
  detail?: Record<string, unknown>;
  /** Set on the Audit lines that start paid work; the hourly cap counts them. */
  visitorHash?: string | null;
};

/** A line a person's action writes. A failure fails the action. */
export async function auditPerson(input: AuditInput) {
  await insertAudit({ ...input, actor: "person" });
}

/** A line the pipeline writes. It never fails the work it describes. */
export async function auditPipeline(input: AuditInput) {
  await insertAudit({ ...input, actor: "pipeline" }).catch((error) => {
    console.error("[process-transfer] could not write an Audit line", error);
  });
}

export type { AuditEvent };
