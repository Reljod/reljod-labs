import { z } from "zod";
import type { AuditListResponse } from "@/features/harness/domain/api";
import {
  ACTOR_KINDS,
  AUDIT_ACTION_IDS,
  type AuditAction,
} from "@/features/harness/domain/audit";
import { LIMITS } from "@/features/harness/domain/limits";
import { harnessApi, permits } from "@/features/harness/server/api";
import { authorize, query } from "@/platform/http/middleware";

const querySchema = z.object({
  session: z.string().uuid().optional(),
  actor: z.enum(ACTOR_KINDS).optional(),
  action: z
    .enum(AUDIT_ACTION_IDS as [AuditAction, ...AuditAction[]])
    .optional(),
  mine: z.enum(["1"]).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.auditPageSize).optional(),
});

/**
 * The Audit trail, newest first. An admin reads the whole Workspace's; a
 * user only the events of their own Sessions, whatever they filter by.
 */
export const GET = harnessApi
  .use(authorize(permits("audit.read.own")))
  .use(query(querySchema))
  .handle(
    ({ services, caller, query }): Promise<AuditListResponse> =>
      services.audit.list(caller, {
        sessionId: query.session ?? null,
        actorKind: query.actor ?? null,
        action: query.action ?? null,
        mine: query.mine === "1",
        before: query.before ?? null,
        limit: query.limit ?? null,
      }),
  );
