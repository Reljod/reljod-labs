import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { ZodError, z } from "zod";
import { isAppError, UnauthorizedError } from "@/platform/errors";
import { ACCESS_PATH } from "../constants";
import type { PassChange } from "../domain/api";
import {
  GUEST_ACCESS_OAUTH_SCOPE,
  GUEST_ACCESS_PROTECTED_RESOURCE_PATH,
  GUEST_ACCESS_SERVER_NAME,
  GUEST_ACCESS_TOOLS,
  type GuestAccessToolName,
} from "../domain/guest-access-mcp";
import {
  durationLabel,
  guestPassStatus,
  LIMITS,
  purgeDate,
} from "../domain/guest-pass";
import type { HostAccess, ListedPass } from "./ports";
import type { GuestPassService } from "./services/guest-passes";
import type { McpConnectService } from "./services/mcp-connect";

/*
 * The Guest access MCP server: a Host manages Guest passes from an MCP client
 * signed in with OAuth. Every tool calls the same GuestPassService as the
 * REST routes, with the Host the bearer acts for; the bearer is checked on
 * every request (still a Host, not disconnected). It checks its own bearer,
 * so it is not on the REST stack.
 */

type Answer = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function answer(lead: string, data?: Record<string, unknown>): Answer {
  return {
    content: [
      {
        type: "text",
        text: data === undefined ? lead : `${lead}\n${JSON.stringify(data)}`,
      },
    ],
    ...(data === undefined ? {} : { structuredContent: data }),
  };
}

/** A refusal a service threw on purpose is the tool's answer; anything else is logged. */
function failure(error: unknown, tool: string): Answer {
  const known = isAppError(error) || error instanceof ZodError;
  if (!known) console.error(`[access] ${tool} failed`, error);
  return {
    content: [
      {
        type: "text",
        text: isAppError(error)
          ? error.message
          : error instanceof ZodError
            ? (error.issues[0]?.message ?? "That input doesn't look right.")
            : "That failed on the server. Try again.",
      },
    ],
    isError: true,
  };
}

function changed(result: PassChange): Answer {
  const lead = result.code
    ? `${result.done} The new Guest code is ${result.code}. It is shown once: hand it to the guest now; they enter it at ${ACCESS_PATH}.`
    : result.done;
  return answer(lead, { ...result });
}

/** A pass as a Host's MCP client reads it. Guest codes are never listed: only their hash is stored. */
function passView(pass: ListedPass, now: number) {
  return {
    id: pass.id,
    label: pass.label,
    status: guestPassStatus(
      {
        expiresAt: pass.expires_at,
        revokedAt: pass.revoked_at,
        deletedAt: pass.deleted_at,
      },
      now,
    ),
    createdAt: pass.created_at,
    expiresAt: pass.expires_at,
    revokedAt: pass.revoked_at,
    deletedAt: pass.deleted_at,
    /** When a deleted pass and its Guests' data go for good. */
    purgedOn: pass.deleted_at ? purgeDate(pass.deleted_at).toISOString() : null,
    devicesUsed: pass.devices,
    maxDevices: pass.max_devices,
  };
}

function hostOf(ctx: unknown): HostAccess {
  const host = (
    ctx as { http?: { authInfo?: { extra?: Record<string, unknown> } } }
  ).http?.authInfo?.extra?.host;
  if (!host) throw new UnauthorizedError("Not signed in as a Host.");
  return host as HostAccess;
}

const DURATIONS = LIMITS.durationsHours.join(", ");

const passId = z
  .string()
  .uuid()
  .describe("The Guest pass id, from list_guest_passes.");
const hours = z
  .number()
  .int()
  .describe(
    `Hours: one of ${DURATIONS} (${LIMITS.durationsHours.map(durationLabel).join(", ")}).`,
  );

type Tool = {
  input: z.ZodObject;
  description: string;
  work: (host: HostAccess, input: never) => Promise<Answer>;
};

function tools(passes: GuestPassService): Record<GuestAccessToolName, Tool> {
  return {
    list_guest_passes: {
      input: z.object({}),
      description:
        "Lists the newest 100 Guest passes, deleted ones included: each one's id, label, status (live, expired, revoked, deleted), when it ends, and how many of its devices are in use. Guest codes are never listed: only their hash is stored.",
      work: async (host) => {
        const now = Date.now();
        const listed = (await passes.list(host)).map((pass) =>
          passView(pass, now),
        );
        const live = listed.filter((pass) => pass.status === "live").length;
        return answer(
          `${listed.length} Guest pass${listed.length === 1 ? "" : "es"}, ${live} of at most ${LIMITS.maxLivePasses} live.`,
          { passes: listed },
        );
      },
    },
    issue_guest_pass: {
      input: z.object({
        label: z
          .string()
          .describe(
            `Who the pass is for, at most ${LIMITS.labelLength} characters.`,
          ),
        hours,
        devices: z
          .number()
          .int()
          .describe(
            `How many browsers may redeem the code, 1 to ${LIMITS.maxDevices}. Usually ${LIMITS.defaultDevices}.`,
          ),
      }),
      description: `Issues a Guest pass that opens the demos for a set time, and returns its Guest code. The code is shown once (only its hash is stored): give it to the Host to hand over; the guest enters it at ${ACCESS_PATH}. At most ${LIMITS.maxLivePasses} passes may be live at once.`,
      work: async (
        host,
        input: { label: string; hours: number; devices: number },
      ) => {
        const issued = await passes.issue(host, input);
        return answer(
          `Issued "${issued.label}" until ${issued.expiresAt}, on ${issued.devices} device${issued.devices === 1 ? "" : "s"}. Its Guest code is ${issued.code}. It is shown once: hand it to the guest now; they enter it at ${ACCESS_PATH}.`,
          { ...issued },
        );
      },
    },
    extend_guest_pass: {
      input: z.object({ id: passId, hours }),
      description: `Adds time to a live Guest pass, or renews one that expired or was revoked (counted from now). A pass never runs more than ${durationLabel(Math.max(...LIMITS.durationsHours))} from now. Its guests get back everything they saved.`,
      work: async (host, input: { id: string; hours: number }) =>
        changed(await passes.extend(host, input.id, input.hours)),
    },
    new_guest_code: {
      input: z.object({ id: passId }),
      description:
        "Gives a Guest pass a new Guest code, when the old one was lost or given to the wrong person. Every device on the old code is signed out at once; whoever enters the new one gets the same saved data. Returns the new code, shown once.",
      work: async (host, input: { id: string }) =>
        changed(await passes.newCode(host, input.id)),
    },
    revoke_guest_pass: {
      input: z.object({ id: passId }),
      description:
        "Ends a live Guest pass now: every guest on it loses access at once. Their data stays with the pass, and extend_guest_pass can renew it later.",
      work: async (host, input: { id: string }) =>
        changed(await passes.revoke(host, input.id)),
    },
    delete_guest_pass: {
      input: z.object({ id: passId }),
      description: `Deletes a Guest pass: its guests lose access at once, and the pass and everything they saved are purged after ${LIMITS.retentionDays} days. restore_guest_pass takes it back until then.`,
      work: async (host, input: { id: string }) =>
        changed(await passes.remove(host, input.id)),
    },
    restore_guest_pass: {
      input: z.object({ id: passId }),
      description:
        "Takes back a deleted Guest pass before it is purged, as it was when deleted, with everything its guests saved.",
      work: async (host, input: { id: string }) =>
        changed(await passes.restore(host, input.id)),
    },
  };
}

export function registerGuestAccessTools(
  server: McpServer,
  passes: GuestPassService,
) {
  const table = tools(passes);
  for (const spec of GUEST_ACCESS_TOOLS) {
    const tool = table[spec.name];
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: spec.title,
          readOnlyHint: spec.readOnly,
          destructiveHint: spec.destructive,
          openWorldHint: false,
        },
      },
      async (input: unknown, ctx: unknown) => {
        try {
          return await tool.work(hostOf(ctx), input as never);
        } catch (error) {
          return failure(error, spec.name);
        }
      },
    );
  }
}

export type McpHandler = (request: Request) => Promise<Response>;

/**
 * Every request carries a Guest access token from OAuth. The 401 names this
 * server's own resource metadata, which names its own issuer, so a client
 * signs in here and nowhere else.
 */
export function createGuestAccessMcp(deps: {
  passes: GuestPassService;
  verify: McpConnectService["verify"];
}): McpHandler {
  const handler = createMcpHandler(
    (server) => registerGuestAccessTools(server, deps.passes),
    { serverInfo: { name: GUEST_ACCESS_SERVER_NAME, version: "1.0.0" } },
  );
  return withMcpAuth(
    handler,
    async (_request, bearer) => {
      if (!bearer) return undefined;
      const verified = await deps.verify(bearer);
      if (!verified) return undefined;
      return {
        token: bearer,
        clientId: "guest-access-oauth",
        scopes: [GUEST_ACCESS_OAUTH_SCOPE],
        expiresAt: verified.exp,
        extra: { host: verified.host },
      };
    },
    {
      required: true,
      resourceMetadataPath: GUEST_ACCESS_PROTECTED_RESOURCE_PATH,
    },
  );
}
