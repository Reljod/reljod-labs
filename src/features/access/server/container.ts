import "server-only";
import { randomBytes } from "node:crypto";
import { container } from "@/platform/services/container";
import { CODE_LENGTH, guestCodeFrom } from "../domain/guest-code";
import { trackAccess } from "./analytics";
import { sessionlessPasswords } from "./browser";
import { env } from "./env";
import { disconnectMcpClientsOf } from "./mcp-tokens";
import type { AccessPorts } from "./ports";
import * as repository from "./repository";
import { createDoorService } from "./services/door";
import { createGuestPassService } from "./services/guest-passes";
import { createMcpClientService } from "./services/mcp-clients";
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
export const accessServices = container(() => ({
  door: createDoorService(ports),
  profile: createProfileService(ports),
  guestPasses: createGuestPassService(ports),
  mcpClients: createMcpClientService(ports),
}));

export type AccessServices = ReturnType<typeof accessServices>;
