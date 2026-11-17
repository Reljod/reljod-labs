import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import type { Access } from "@/features/access/server/gate";
import { guestPassOf } from "@/features/access/server/repository";
import type { McpTokenResponse } from "../domain/api";
import { HARNESS_MCP_PATH } from "../domain/mcp-tools";
import {
  type Grant,
  type HarnessClaims,
  readHarnessToken,
  signHarnessToken,
} from "../domain/oauth";
import { can } from "../domain/permissions";
import type { Staff } from "../domain/staff";
import type { PaidActor } from "./actor";
import { audit } from "./audit";
import type { StaffContext } from "./context";
import { env } from "./env";
import { ForbiddenError } from "./errors";
import { TRUSTED_VISITOR, type Visitor } from "./rate";
import { ownedStaff } from "./staff";

const DAY = 86_400;
/** A chat turn's token: long enough for a turn, short enough not to matter if seen. */
const CHAT_TOKEN_SECONDS = 10 * 60;

/**
 * What a person allows an outside MCP client when they are signed in with
 * this Access, acting as this Staff member of their own Workspace. A Guest's
 * lasts as long as their Guest pass; a Host's 30 days; the e2e suite's a day.
 */
export function grantOf(
  access: Access,
  owner: Owner,
  staff: Pick<Staff, "id">,
  who: Visitor,
  now = Date.now(),
): Grant {
  const seconds = Math.floor(now / 1000);
  const base = { owner, staffId: staff.id, visitor: who.hash };
  switch (access.kind) {
    case "guest":
      return {
        ...base,
        kind: "guest",
        user: access.userId,
        pass: access.passId,
        until: Math.floor(Date.parse(access.expiresAt) / 1000),
      };
    case "host":
      return {
        ...base,
        kind: "host",
        email: access.email,
        until: seconds + 30 * DAY,
      };
    case "e2e":
      return { ...base, kind: "e2e", until: seconds + DAY };
  }
}

/**
 * A token to paste, for an MCP client that cannot sign in with OAuth. It acts
 * as the Staff member signed in now (ADR 0013: fixed at mint time). A Guest's
 * also goes in `X-Guest-Token` beside an OAuth sign-in. Checks `mcp.connect`
 * and writes `mcp.connected`.
 */
export async function mintPastedToken(
  context: StaffContext,
  origin: string,
): Promise<McpTokenResponse> {
  const { access, owner, staff, visitor } = context;
  if (!can(staff, "mcp.connect")) throw ForbiddenError.forAction("mcp.connect");
  const { until, ...claims } = grantOf(access, owner, staff, visitor);
  const token = signHarnessToken(
    { ...claims, via: "pasted", exp: until },
    env.rateLimitSalt(),
  );
  await audit({
    owner,
    actor: { kind: "staff", staff },
    action: "mcp.connected",
    summary: `Took an MCP token acting as ${staff.name}`,
    target: { kind: "staff", id: staff.id },
    detail: { via: "pasted", role: staff.role, expiresAt: until },
  });
  return {
    token,
    expiresAt: new Date(until * 1000).toISOString(),
    url: `${origin}${HARNESS_MCP_PATH}`,
    staff,
  };
}

/**
 * The built-in chat's token for one turn: the Session's Staff member, the
 * Session itself (its Sandbox, where its Runs are filed), ten minutes.
 */
export function chatToken(input: {
  access: Access;
  owner: Owner;
  staff: Pick<Staff, "id">;
  visitor: Visitor;
  sessionId: string;
}): string {
  const { until: _until, ...claims } = grantOf(
    input.access,
    input.owner,
    input.staff,
    input.visitor,
  );
  return signHarnessToken(
    {
      ...claims,
      via: "chat",
      sessionId: input.sessionId,
      exp: Math.floor(Date.now() / 1000) + CHAT_TOKEN_SECONDS,
    },
    env.rateLimitSalt(),
  );
}

/**
 * The claims of a bearer, if it may still be used: signed here, not expired,
 * and its holder still has Access (a Guest still on that live Guest pass, a
 * Host still on the Host list, the e2e token still configured).
 */
export async function verifyBearer(
  bearer: string,
): Promise<HarnessClaims | null> {
  const claims = readHarnessToken(bearer, env.rateLimitSalt());
  if (!claims) return null;
  switch (claims.kind) {
    case "e2e":
      return claims.owner === "e2e" && env.e2eBypassToken() ? claims : null;
    case "host":
      return claims.owner.startsWith("host:") &&
        claims.email &&
        accessEnv.hostEmails().includes(claims.email)
        ? claims
        : null;
    case "guest": {
      if (!claims.user || !claims.pass) return null;
      if (claims.owner !== `guest:${claims.pass}`) return null;
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

export function visitorOf(claims: HarnessClaims): Visitor {
  return {
    hash: claims.visitor,
    trusted: claims.kind === "e2e" || claims.visitor === TRUSTED_VISITOR,
  };
}

/** Who an MCP call acts as. The Staff row must still be the Owner's. */
export type McpActor = PaidActor & { claims: HarnessClaims };

export async function actorOf(claims: HarnessClaims): Promise<McpActor | null> {
  const staff = await ownedStaff(claims.owner, claims.staffId);
  if (!staff) return null;
  return { owner: claims.owner, staff, visitor: visitorOf(claims), claims };
}
