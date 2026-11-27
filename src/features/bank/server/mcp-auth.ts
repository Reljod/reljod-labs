import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import {
  type BankClaims,
  readBankToken,
  signBankToken,
} from "../domain/mcp-token";
import { env } from "./env";
import type { StaffContext, TokenSigner } from "./ports";

const DAY = 86_400;
/** The Teller's token for one turn: long enough for a turn, short enough not to matter if seen. */
const CHAT_TOKEN_SECONDS = 10 * 60;

function baseClaims(context: StaffContext) {
  const { access, owner, staff, visitor } = context;
  const now = Math.floor(Date.now() / 1000);
  const base = { owner, staffId: staff.id, visitor: visitor.hash };
  switch (access.kind) {
    case "guest":
      return {
        ...base,
        kind: "guest" as const,
        user: access.userId,
        pass: access.passId,
        until: Math.floor(Date.parse(access.expiresAt) / 1000),
      };
    case "host":
      return {
        ...base,
        kind: "host" as const,
        email: access.email,
        until: now + 30 * DAY,
      };
    case "e2e":
      return { ...base, kind: "e2e" as const, until: now + DAY };
  }
}

/** Bank MCP tokens, signed with RATE_LIMIT_SALT (rotating it revokes them all). */
export const tokenSigner: TokenSigner = {
  client(context) {
    const { until, ...claims } = baseClaims(context);
    return {
      token: signBankToken(
        { ...claims, via: "mcp", exp: until },
        env.rateLimitSalt(),
      ),
      expiresAt: until,
    };
  },
  chat(context, sessionId) {
    const { until: _until, ...claims } = baseClaims(context);
    return signBankToken(
      {
        ...claims,
        via: "chat",
        sessionId,
        exp: Math.floor(Date.now() / 1000) + CHAT_TOKEN_SECONDS,
      },
      env.rateLimitSalt(),
    );
  },
};

/** The claims of a bearer, if its holder still has Access. */
export async function verifyBearer(bearer: string): Promise<BankClaims | null> {
  const claims = readBankToken(bearer, env.rateLimitSalt());
  if (!claims) return null;
  switch (claims.kind) {
    case "e2e":
      return env.e2eBypassToken() ? claims : null;
    case "host":
      return claims.email && accessEnv.hostEmails().includes(claims.email)
        ? claims
        : null;
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
