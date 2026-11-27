import type { Owner } from "@/features/access/domain/owner";
import type { AuditQuery, AuditResponse } from "../../domain/api";
import type { AuditLog } from "../ports";

/** The Owner's Audit trail, newest first, optionally for one run or one action. */
export interface AuditService {
  list(owner: Owner, query?: Partial<AuditQuery>): Promise<AuditResponse>;
}

export function createAuditService(ports: { audit: AuditLog }): AuditService {
  return { list: (owner, query = {}) => ports.audit.list(owner, query) };
}
