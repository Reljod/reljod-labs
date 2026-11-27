import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Access } from "@/features/access/server/gate";
import { E2E_VISITOR_HASH } from "@/platform/request/visitor";
import {
  type CanvasClaims,
  readCanvasToken,
  signCanvasToken,
  type TokenVia,
} from "../../domain/token";
import type { AccessChecks, Caller, TrailRepository } from "../ports";

const DAY = 86_400;
/** A chat turn's or the Host's token: long enough for a turn, short enough not to matter if seen. */
const SHORT_SECONDS = 10 * 60;

/** Who a bearer acts as, and whether its requests run on the stubbed adapters. */
export type Bearer = { caller: Caller; stub: boolean };

/**
 * Canvas MCP tokens (ADR 0031): a chat turn's and the page Host's, minted
 * here for the server's own in-process calls, and the one a person takes
 * for an outside client. Every request checks that its holder still has
 * Access, so a token dies with its Guest pass. A token minted for the e2e
 * suite carries the request's stub mode, so the MCP requests it makes run
 * on the same adapters as the request that minted it.
 */
export interface ConnectService {
  /** A short-lived token for this server's own calls to the MCP server. */
  shortToken(access: Access, caller: Caller, via: "chat" | "host"): string;
  /** A token to paste into an MCP client, written to the Trail before it is handed over. */
  mint(
    access: Access,
    caller: Caller,
  ): Promise<{ token: string; expiresAt: string }>;
  /** The Caller a bearer acts as, if it may still be used. */
  bearer(token: string): Promise<Bearer | null>;
}

export function createConnectService(ports: {
  access: AccessChecks;
  trail: TrailRepository;
  /** Signs every token (RATE_LIMIT_SALT): rotating it revokes them all. */
  secret: () => string;
  now: () => number;
  /** These services run on the stubbed adapters (the e2e suite without `x-e2e-live`). */
  stub: boolean;
}): ConnectService {
  const nowSeconds = () => Math.floor(ports.now() / 1000);

  function claimsFor(
    access: Access,
    caller: Pick<Caller, "owner" | "visitor">,
    via: TokenVia,
    exp: number,
  ): CanvasClaims {
    const base = {
      via,
      owner: caller.owner,
      visitor: caller.visitor.hash,
      exp,
    };
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
        return { ...base, kind: "e2e", ...(ports.stub ? { stub: true } : {}) };
    }
  }

  /** Whether a signed token's holder still has Access: a live Guest pass, a Host still on the list. */
  async function stillAllowed(claims: CanvasClaims) {
    switch (claims.kind) {
      case "e2e":
        return ports.access.e2eEnabled();
      case "host":
        return Boolean(
          claims.email && ports.access.hostEmails().includes(claims.email),
        );
      case "guest": {
        if (!claims.user || !claims.pass) return false;
        const pass = await ports.access.guestPass(claims.user);
        if (!pass || pass.id !== claims.pass) return false;
        return (
          guestPassStatus(
            {
              expiresAt: pass.expires_at,
              revokedAt: pass.revoked_at,
              deletedAt: pass.deleted_at,
            },
            ports.now(),
          ) === "live"
        );
      }
    }
  }

  return {
    shortToken(access, caller, via) {
      return signCanvasToken(
        {
          ...claimsFor(access, caller, via, nowSeconds() + SHORT_SECONDS),
          ...(caller.conversationId
            ? { conversationId: caller.conversationId }
            : {}),
          ...(caller.questionId ? { questionId: caller.questionId } : {}),
        },
        ports.secret(),
      );
    },

    async mint(access, caller) {
      const now = nowSeconds();
      // A Guest's lasts as long as their Guest pass; a Host's 30 days; the e2e suite's a day.
      const exp =
        access.kind === "guest"
          ? Math.floor(Date.parse(access.expiresAt) / 1000)
          : access.kind === "host"
            ? now + 30 * DAY
            : now + DAY;
      const token = signCanvasToken(
        claimsFor(access, caller, "pasted", exp),
        ports.secret(),
      );
      await ports.trail.strict(caller, {
        action: "mcp.connected",
        summary: "Took an MCP token for an outside client",
        detail: { via: "pasted", expiresAt: exp },
      });
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    },

    async bearer(token) {
      const claims = readCanvasToken(token, ports.secret(), ports.now());
      if (!claims || !(await stillAllowed(claims))) return null;
      const e2e = claims.kind === "e2e";
      return {
        caller: {
          owner: claims.owner,
          visitor: {
            hash: claims.visitor,
            trusted: e2e || claims.visitor === E2E_VISITOR_HASH,
          },
          actor:
            claims.via === "chat"
              ? "analyst"
              : claims.via === "host"
                ? "person"
                : "client",
          ...(claims.conversationId
            ? { conversationId: claims.conversationId }
            : {}),
          ...(claims.questionId ? { questionId: claims.questionId } : {}),
        },
        // Only the e2e suite's own tokens can ask for the canned adapters.
        stub: e2e && claims.stub === true,
      };
    },
  };
}
