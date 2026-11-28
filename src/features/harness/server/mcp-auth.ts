import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import type { Access } from "@/features/access/server/gate";
import { issuedSinceDisconnect } from "@/features/access/server/mcp-tokens";
import { guestPassOf } from "@/features/access/server/repository";
import type { Visitor } from "@/platform/request/visitor";
import {
  type Grant,
  type HarnessClaims,
  readHarnessToken,
  signHarnessToken,
} from "../domain/oauth";
import type { Staff } from "../domain/staff";
import { env } from "./env";
import type { PaidActor } from "./ports";
import { ownedStaff } from "./staff";

/** The visitor hash the e2e suite's tokens carry: no visitor cap applies to it. */
const TRUSTED_VISITOR = "e2e";

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
  const base = { owner, staffId: staff.id, visitor: who.hash, iat: seconds };
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

/** A pasted token's claims, signed: it acts as the Staff member until the Grant ends. */
export function pastedToken(grant: Grant): string {
  const { until, ...claims } = grant;
  return signHarnessToken(
    { ...claims, via: "pasted", exp: until },
    env.rateLimitSalt(),
  );
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
 * its holder still has Access (a Guest still on that live Guest pass, a Host
 * still on the Host list, the e2e token still configured), and issued after
 * its Owner last pressed "Disconnect all MCP clients". The token endpoint
 * checks every token it mints here too, so a refresh token or code from
 * before a disconnect mints nothing.
 */
export async function verifyBearer(
  bearer: string,
): Promise<HarnessClaims | null> {
  const claims = readHarnessToken(bearer, env.rateLimitSalt());
  if (!claims) return null;
  const [standing, holder] = await Promise.all([
    issuedSinceDisconnect(claims.owner, claims.iat),
    holderOf(claims),
  ]);
  return standing ? holder : null;
}

async function holderOf(claims: HarnessClaims): Promise<HarnessClaims | null> {
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
