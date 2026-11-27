import "server-only";
import { callbackVouched } from "@/features/access/domain/mcp-clients";
import { ForbiddenError, InvalidError } from "@/platform/errors";
import type { ConsentRequest, McpTokenResponse } from "../../domain/api";
import { HARNESS_MCP_PATH } from "../../domain/mcp-tools";
import {
  approvedRedirect,
  errorRedirect,
  parseAuthorizationRequest,
} from "../../domain/oauth";
import { refusalFor } from "../../domain/permissions";
import { assertCan } from "../errors";
import { grantOf, pastedToken } from "../mcp-auth";
import type { AuditLog, Caller } from "../ports";
import type { StaffService } from "./staff";

/** A person's answer on the consent page, as posted. */
export type ConsentAnswer = ConsentRequest;

/**
 * Connecting an outside MCP client (ADR 0013): a token to paste, or an OAuth
 * sign-in through the consent page. Either acts as one Staff member of the
 * caller's own Workspace, fixed at mint time, and is recorded as
 * `mcp.connected` before it is handed over (no client connects untraced).
 */
export interface ConnectService {
  /** A token to paste: the Staff member signed in now, for as long as the visitor's Access lasts. */
  mintToken(caller: Caller, origin: string): Promise<McpTokenResponse>;
  /**
   * Allow or Deny on the consent page: where to send the browser. Allow
   * mints the code from the caller's Access, acting as the Staff member
   * chosen. A refusal the person can fix is a 400 with its reason.
   */
  consent(caller: Caller, answer: ConsentAnswer): Promise<{ redirect: string }>;
}

export function createConnectService(ports: {
  staff: Pick<StaffService, "owned">;
  audit: AuditLog;
  /** Signs every Harness token and code (`RATE_LIMIT_SALT`). */
  secret: () => string;
  now: () => number;
}): ConnectService {
  return {
    async mintToken(caller, origin) {
      const { access, owner, staff, visitor } = caller;
      assertCan(staff, "mcp.connect");
      const grant = grantOf(access, owner, staff, visitor);
      const token = pastedToken(grant);
      // Written before the token is handed over, and the token is not
      // handed over if it cannot be.
      await ports.audit.strict({
        owner,
        actor: { kind: "staff", staff },
        action: "mcp.connected",
        summary: `Took an MCP token acting as ${staff.name}`,
        target: { kind: "staff", id: staff.id },
        detail: { via: "pasted", role: staff.role, expiresAt: grant.until },
      });
      return {
        token,
        expiresAt: new Date(grant.until * 1000).toISOString(),
        url: `${origin}${HARNESS_MCP_PATH}`,
        staff,
      };
    },

    async consent(caller, answer) {
      const secret = ports.secret();
      const parsed = parseAuthorizationRequest(
        new URLSearchParams(answer.request),
        secret,
      );
      if (parsed.kind === "invalid") throw new InvalidError(parsed.message);
      // Only after Access (the route's gate): anyone can register a client
      // with any https callback, so nobody without Access is sent to one.
      if (parsed.kind === "error") return { redirect: parsed.redirect };
      const { request } = parsed;
      if (answer.answer !== "allow") {
        return {
          redirect: errorRedirect(
            request.redirectUri,
            request.state,
            "access_denied",
            "The person said no.",
          ),
        };
      }
      const host = new URL(request.redirectUri).host;
      if (!callbackVouched(request.redirectUri, answer.trustHost))
        throw new InvalidError(`Tick "I trust ${host}" first, or Deny.`);
      const staff = await ports.staff.owned(caller.owner, answer.staffId);
      if (!staff)
        throw new InvalidError("Choose a Staff member of this Workspace.");
      if (refusalFor(staff, "mcp.connect") !== null)
        throw new ForbiddenError(
          `${staff.name}'s Role may not connect an MCP client.`,
        );
      const grant = grantOf(caller.access, caller.owner, staff, caller.visitor);
      // Before the code is issued, and no code if it cannot be written.
      await ports.audit.strict({
        owner: caller.owner,
        actor: { kind: "staff", staff },
        action: "mcp.connected",
        summary: `Let ${request.client.name} act as ${staff.name}`,
        target: { kind: "staff", id: staff.id },
        detail: {
          via: "oauth",
          client: request.client.name,
          callbackHost: host,
          role: staff.role,
          until: grant.until,
        },
      });
      return {
        redirect: approvedRedirect(request, grant, secret, ports.now()),
      };
    },
  };
}
