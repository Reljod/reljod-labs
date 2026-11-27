import "server-only";
import { randomBytes } from "node:crypto";
import { container } from "@/platform/services/container";
import { CODE_LENGTH, guestCodeFrom } from "../domain/guest-code";
import { trackAccess } from "./analytics";
import { sessionlessPasswords } from "./browser";
import { env } from "./env";
import { hostById } from "./gate";
import { createGuestAccessMcp } from "./mcp";
import {
  disconnectMcpClientsOf,
  issuedSinceDisconnect,
  redeemCodeOnce,
} from "./mcp-tokens";
import type { AccessPorts } from "./ports";
import * as repository from "./repository";
import { createDoorService } from "./services/door";
import { createGuestPassService } from "./services/guest-passes";
import { createMcpClientService } from "./services/mcp-clients";
import { createMcpConnectService } from "./services/mcp-connect";
import { createProfileService } from "./services/profile";

const ports: AccessPorts = {
  door: {
    takeAttempt: repository.takeAttempt,
    settleAttempt: repository.settleAttempt,
    releaseAttempt: repository.releaseAttempt,
    codeLooksGood: repository.codeLooksGood,
    redeem: repository.redeem,
    deleteGuest: repository.deleteGuest,
    endGuestSession: repository.endGuestSession,
  },
  passes: {
    countLive: repository.countLivePasses,
    list: repository.listGuestPasses,
    byId: repository.guestPassById,
    insert: repository.insertGuestPass,
    revoke: repository.revokeGuestPass,
    extend: repository.extendGuestPass,
    replaceCode: repository.replaceGuestCode,
    markDeleted: repository.markGuestPassDeleted,
    restore: repository.restoreGuestPass,
  },
  passwords: sessionlessPasswords,
  analytics: { track: trackAccess },
  tokens: { disconnectAll: disconnectMcpClientsOf },
  authReady: () => Boolean(env.supabasePublishableKey()),
  newGuestCode: () => guestCodeFrom(randomBytes(CODE_LENGTH)),
  now: () => new Date(),
};

/**
 * Access's composition root. Nothing here is paid, so the stubbed e2e suite
 * gets the same services: the real door, its caps and the database.
 */
export const accessServices = container(() => {
  const guestPasses = createGuestPassService(ports);
  const mcpConnect = createMcpConnectService({
    secret: env.rateLimitSalt,
    now: Date.now,
    hostById,
    issuedSinceDisconnect,
    redeemCodeOnce,
  });
  return {
    door: createDoorService(ports),
    profile: createProfileService(ports),
    guestPasses,
    mcpClients: createMcpClientService(ports),
    mcpConnect,
    /** The Guest access MCP server, over the same Guest pass service. */
    mcp: createGuestAccessMcp({
      passes: guestPasses,
      verify: mcpConnect.verify,
    }),
  };
});

export type AccessServices = ReturnType<typeof accessServices>;
