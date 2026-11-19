import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import { env as accessEnv } from "@/features/access/server/env";
import type { Access } from "@/features/access/server/gate";
import { guestPassOf } from "@/features/access/server/repository";
import {
  type CanvasClaims,
  readCanvasToken,
  signCanvasToken,
  type TokenVia,
} from "../domain/token";
import type { Caller } from "./caller";
import { env } from "./env";
import { TRUSTED_VISITOR, type Visitor } from "./rate";
import { trailStrict } from "./trail";

const DAY = 86_400;
/** A chat turn's or the Host's token: long enough for a turn, short enough not to matter if seen. */
const SHORT_SECONDS = 10 * 60;

function claimsFor(
  access: Access,
  caller: Pick<Caller, "owner" | "visitor">,
  via: TokenVia,
  exp: number,
): CanvasClaims {
  const base = { via, owner: caller.owner, visitor: caller.visitor.hash, exp };
  switch (access.kind) {
    case "guest":
      return {
        ...base,
        kind: "guest",
        user: access.userId,
        pass: access.passId,
      };
    case "host":
      return { ...base, kind: "host", email: access.email };
    case "e2e":
      return { ...base, kind: "e2e" };
  }
}

/** A short-lived token for this server's own calls to the MCP server: a chat turn's, or the page Host's. */
export function shortToken(
  access: Access,
  caller: Caller,
  via: "chat" | "host",
): string {
  return signCanvasToken(
    {
      ...claimsFor(
        access,
        caller,
        via,
        Math.floor(Date.now() / 1000) + SHORT_SECONDS,
      ),
      ...(caller.conversationId
        ? { conversationId: caller.conversationId }
        : {}),
      ...(caller.questionId ? { questionId: caller.questionId } : {}),
    },
    env.rateLimitSalt(),
  );
}

/**
 * A token to paste into an MCP client (Claude). A Guest's lasts as long as
 * their Guest pass; a Host's 30 days; the e2e suite's a day. Written to the
 * Trail before it is handed over.
 */
export async function mintPastedToken(access: Access, caller: Caller) {
  const now = Math.floor(Date.now() / 1000);
  const exp =
    access.kind === "guest"
      ? Math.floor(Date.parse(access.expiresAt) / 1000)
      : access.kind === "host"
        ? now + 30 * DAY
        : now + DAY;
  const token = signCanvasToken(
    claimsFor(access, caller, "pasted", exp),
    env.rateLimitSalt(),
  );
  await trailStrict(caller, {
    action: "mcp.connected",
    summary: "Took an MCP token for an outside client",
    detail: { via: "pasted", expiresAt: exp },
  });
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Whether a signed token's holder still has Access: a live Guest pass, a Host still on the list. */
async function stillAllowed(claims: CanvasClaims) {
  switch (claims.kind) {
    case "e2e":
      return Boolean(env.e2eBypassToken());
    case "host":
      return Boolean(
        claims.email && accessEnv.hostEmails().includes(claims.email),
      );
    case "guest": {
      if (!claims.user || !claims.pass) return false;
      const pass = await guestPassOf(claims.user);
      if (!pass || pass.id !== claims.pass) return false;
      return (
        guestPassStatus({
          expiresAt: pass.expires_at,
          revokedAt: pass.revoked_at,
          deletedAt: pass.deleted_at,
        }) === "live"
      );
    }
  }
}

/** The Caller a bearer acts as, if it may still be used. */
export async function callerOfBearer(bearer: string): Promise<Caller | null> {
  const claims = readCanvasToken(bearer, env.rateLimitSalt());
  if (!claims || !(await stillAllowed(claims))) return null;
  const visitor: Visitor = {
    hash: claims.visitor,
    trusted: claims.kind === "e2e" || claims.visitor === TRUSTED_VISITOR,
  };
  return {
    owner: claims.owner,
    visitor,
    actor:
      claims.via === "chat"
        ? "analyst"
        : claims.via === "host"
          ? "person"
          : "client",
    ...(claims.conversationId ? { conversationId: claims.conversationId } : {}),
    ...(claims.questionId ? { questionId: claims.questionId } : {}),
  };
}
