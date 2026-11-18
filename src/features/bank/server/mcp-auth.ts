import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import type { Access } from "@/features/access/server/gate";
import { guestPassOf } from "@/features/access/server/repository";
import type { Actor } from "../core/actor";
import { auditIn } from "../core/audit";
import { ForbiddenError } from "../core/errors";
import { BANK_MCP_PATH, type McpTokenResponse } from "../domain/api";
import { type BankClaims, readBankToken, signBankToken } from "../domain/mcp-token";
import { can } from "../domain/permissions";
import type { Staff } from "../domain/staff";
import type { StaffContext } from "./context";
import { sql } from "./db";
import { env } from "./env";
import { E2E_VISITOR, type Visitor } from "./rate";

const DAY = 86_400;
/** The Teller's token for one turn: long enough for a turn, short enough not to matter if seen. */
const CHAT_TOKEN_SECONDS = 10 * 60;

function baseClaims(access: Access, owner: Owner, staff: Pick<Staff, "id">, who: Visitor) {
  const now = Math.floor(Date.now() / 1000);
  const base = { owner, staffId: staff.id, visitor: who.hash };
  switch (access.kind) {
    case "guest":
      return {
        ...base, kind: "guest" as const, user: access.userId, pass: access.passId,
        until: Math.floor(Date.parse(access.expiresAt) / 1000),
      };
    case "host":
      return { ...base, kind: "host" as const, email: access.email, until: now + 30 * DAY };
    case "e2e":
      return { ...base, kind: "e2e" as const, until: now + DAY };
  }
}

/**
 * A token to paste into an outside MCP client. It acts as the Staff member
 * signed in now, for this Owner alone, under their limits. Writes
 * `mcp.connected` before the token is handed over.
 */
export async function mintToken(context: StaffContext, origin: string): Promise<McpTokenResponse> {
  if (!can(context.staff, "mcp.connect")) {
    throw new ForbiddenError("Your Role may not connect an MCP client.");
  }
  const { until, ...claims } = baseClaims(context.access, context.owner, context.staff, context.visitor);
  const token = signBankToken({ ...claims, via: "mcp", exp: until }, env.rateLimitSalt());
  await auditIn(sql(), { actor: { owner: context.owner, staff: context.staff, via: "app" } }, {
    action: "mcp.connected",
    summary: `Took an MCP token acting as ${context.staff.name}`,
    target: { kind: "staff", id: context.staff.id },
    detail: { role: context.staff.role, expiresAt: until },
  });
  return {
    token,
    url: `${origin}${BANK_MCP_PATH}`,
    expiresAt: new Date(until * 1000).toISOString(),
    staffName: context.staff.name,
  };
}

/** The Teller's token for one chat turn. */
export function chatToken(context: StaffContext, sessionId: string): string {
  const { until: _until, ...claims } = baseClaims(context.access, context.owner, context.staff, context.visitor);
  return signBankToken(
    { ...claims, via: "chat", sessionId, exp: Math.floor(Date.now() / 1000) + CHAT_TOKEN_SECONDS },
    env.rateLimitSalt(),
  );
}

/** The claims of a bearer, if its holder still has Access. */
export async function verifyBearer(bearer: string): Promise<BankClaims | null> {
  const claims = readBankToken(bearer, env.rateLimitSalt());
  if (!claims) return null;
  switch (claims.kind) {
    case "e2e":
      return env.e2eBypassToken() ? claims : null;
    case "host":
      return claims.email && accessEnv.hostEmails().includes(claims.email) ? claims : null;
    case "guest": {
      if (!claims.user || !claims.pass) return null;
      const pass = await guestPassOf(claims.user);
      if (!pass || pass.id !== claims.pass) return null;
      const status = guestPassStatus({
        expiresAt: pass.expires_at,
        revokedAt: pass.revoked_at,
        deletedAt: pass.deleted_at,
      });
      return status === "live" ? claims : null;
    }
  }
}

export type Caller = { actor: Actor; visitor: Visitor };

/** Who an MCP call acts as. The Staff row must still be the Owner's. */
export async function callerOf(claims: BankClaims): Promise<Caller | null> {
  const [staff] = await sql()<Staff[]>`
    select id, key, name, title, role, initials from bank.staff
    where owner = ${claims.owner} and id = ${claims.staffId}`;
  if (!staff) return null;
  return {
    actor: { owner: claims.owner, staff, via: claims.via, sessionId: claims.sessionId ?? null },
    visitor: { hash: claims.visitor, trusted: claims.kind === "e2e" || claims.visitor === E2E_VISITOR },
  };
}
