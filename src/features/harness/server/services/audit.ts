import "server-only";
import type { ActorKind, AuditAction, AuditEvent } from "../../domain/audit";
import { LIMITS } from "../../domain/limits";
import { can } from "../../domain/permissions";
import { assertCan } from "../errors";
import type { Actor, AuditRepository } from "../ports";

export type AuditQuery = {
  sessionId?: string | null;
  actorKind?: ActorKind | null;
  action?: AuditAction | null;
  /** An admin's "My Sessions": only the events of the Sessions they own. */
  mine?: boolean;
  /** Events older than this event id. */
  before?: number | null;
  limit?: number | null;
};

export type AuditPage = {
  events: AuditEvent[];
  nextBefore: number | null;
  scope: "workspace" | "own";
};

/**
 * Reading the Audit trail (ADR 0018). How much of it a reader sees is the
 * Role's (`can`): an admin reads the whole Workspace's, a user only the
 * events of their own Sessions, whatever filter they send.
 */
export interface AuditService {
  list(actor: Actor, query: AuditQuery): Promise<AuditPage>;
}

export function createAuditService(ports: {
  trail: AuditRepository;
}): AuditService {
  return {
    async list(actor, query) {
      assertCan(actor.staff, "audit.read.own");
      const scope = can(actor.staff, "audit.read.workspace")
        ? ("workspace" as const)
        : ("own" as const);
      const limit = Math.max(
        1,
        Math.min(
          Math.trunc(query.limit ?? LIMITS.auditPageSize) ||
            LIMITS.auditPageSize,
          LIMITS.auditPageSize,
        ),
      );
      const before =
        typeof query.before === "number" && Number.isFinite(query.before)
          ? Math.trunc(query.before)
          : null;
      const page = await ports.trail.page({
        owner: actor.owner,
        staffId: actor.staff.id,
        scope,
        mine: scope === "workspace" && query.mine === true,
        sessionId: query.sessionId ?? null,
        actorKind: query.actorKind ?? null,
        action: query.action ?? null,
        before,
        limit,
      });
      return { ...page, scope };
    },
  };
}
