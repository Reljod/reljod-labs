import { z } from "zod";
import type { AuditListResponse } from "@/features/harness/domain/api";
import { ACTOR_KINDS, AUDIT_ACTION_IDS } from "@/features/harness/domain/audit";
import { LIMITS } from "@/features/harness/domain/limits";
import { listAudit } from "@/features/harness/server/audit";
import { requirePermission } from "@/features/harness/server/context";
import { failure, json } from "@/features/harness/server/respond";

const querySchema = z.object({
  session: z.string().uuid().optional(),
  actor: z.enum(ACTOR_KINDS).optional(),
  action: z.enum(AUDIT_ACTION_IDS as [string, ...string[]]).optional(),
  mine: z.enum(["1"]).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.auditPageSize).optional(),
});

/**
 * The Audit trail, newest first. An admin reads the whole Workspace's; a
 * user only the events of their own Sessions, whatever they filter by.
 */
export async function GET(request: Request) {
  try {
    const context = await requirePermission("audit.read.own");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const action = AUDIT_ACTION_IDS.find((id) => id === query.action) ?? null;
    return json<AuditListResponse>(
      await listAudit({
        owner: context.owner,
        staff: context.staff,
        sessionId: query.session ?? null,
        actorKind: query.actor ?? null,
        action,
        mine: query.mine === "1",
        before: query.before ?? null,
        limit: query.limit ?? null,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
