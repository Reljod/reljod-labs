import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { Visitor } from "@/platform/request/visitor";
import type { Actor } from "../../core/actor";
import { isUuid } from "../../core/db";
import { ForbiddenError, NotFoundError } from "../../core/errors";
import type { McpTokenResponse } from "../../domain/api";
import type { Via } from "../../domain/commands";
import type { BankClaims } from "../../domain/mcp-token";
import { can } from "../../domain/permissions";
import { defaultStaff, type Staff } from "../../domain/staff";
import type {
  AuditLog,
  Caller,
  StaffContext,
  StaffRepository,
  TokenSigner,
} from "../ports";

export const actorOf = (
  context: Pick<StaffContext, "owner" | "staff">,
  via: Via = "app",
  sessionId: string | null = null,
): Actor => ({ owner: context.owner, staff: context.staff, via, sessionId });

/** The e2e suite's visitor hash (`visitorOf` in `src/platform/request/visitor.ts`). */
const E2E_VISITOR = "e2e";

export interface StaffService {
  /**
   * The Staff member a request acts as. `chosen` is the `bank_staff` cookie:
   * it only remembers which of the Owner's own Staff is active, and is
   * checked against the Owner here on every request.
   */
  signIn(
    who: { access: Access; owner: Owner; visitor: Visitor },
    chosen: string | null,
  ): Promise<StaffContext>;
  /** Becomes another Staff member of the Owner's own bank, and says so in the trail. */
  switchTo(context: StaffContext, staffId: string): Promise<Staff>;
  /**
   * A token for an outside MCP client, acting as the Staff member signed in
   * now. Writes `mcp.connected` before the token is handed over.
   */
  connect(context: StaffContext, origin: string): Promise<McpTokenResponse>;
  /** Who an MCP call acts as; null when the token's Staff member is no longer the Owner's. */
  caller(claims: BankClaims): Promise<Caller | null>;
}

export type StaffPorts = {
  staff: StaffRepository;
  audit: AuditLog;
  tokens: TokenSigner;
  mcpPath: string;
};

export function createStaffService(ports: StaffPorts): StaffService {
  const { staff, audit, tokens } = ports;
  return {
    async signIn({ access, owner, visitor }, chosen) {
      const everyone = await staff.open(owner);
      const active =
        (isUuid(chosen)
          ? everyone.find((member) => member.id === chosen)
          : null) ?? defaultStaff(everyone);
      if (!active) throw new Error("The bank has no Staff");
      return { access, owner, staff: active, everyone, visitor };
    },

    async switchTo(context, staffId) {
      const to = context.everyone.find((member) => member.id === staffId);
      if (!to)
        throw new NotFoundError("That Staff member is not in this bank.");
      if (to.id !== context.staff.id) {
        await audit.record(actorOf({ owner: context.owner, staff: to }), {
          action: "staff.switched",
          summary: `Signed in as ${to.name} (${to.role}), was ${context.staff.name}`,
          target: { kind: "staff", id: to.id },
          detail: { from: context.staff.name, to: to.name },
        });
      }
      return to;
    },

    async connect(context, origin) {
      if (!can(context.staff, "mcp.connect"))
        throw new ForbiddenError("Your Role may not connect an MCP client.");
      const { token, expiresAt } = tokens.client(context);
      await audit.record(actorOf(context), {
        action: "mcp.connected",
        summary: `Took an MCP token acting as ${context.staff.name}`,
        target: { kind: "staff", id: context.staff.id },
        detail: { role: context.staff.role, expiresAt },
      });
      return {
        token,
        url: `${origin}${ports.mcpPath}`,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        staffName: context.staff.name,
      };
    },

    async caller(claims) {
      const member = await staff.find(claims.owner, claims.staffId);
      if (!member) return null;
      return {
        actor: {
          owner: claims.owner,
          staff: member,
          via: claims.via,
          sessionId: claims.sessionId ?? null,
        },
        visitor: {
          hash: claims.visitor,
          trusted: claims.kind === "e2e" || claims.visitor === E2E_VISITOR,
        },
      };
    },
  };
}
