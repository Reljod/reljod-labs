import type { AuditResponse } from "@/features/loupe/domain/api";
import { loupeApi } from "@/features/loupe/server/api";

/** The Owner's Audit trail, newest first. */
export const GET = loupeApi.handle(
  ({ services, owner }): Promise<AuditResponse> =>
    services.examinations.audit(owner),
);
