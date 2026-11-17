import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import { MODEL_IDS, type ModelId } from "../domain/contract";
import { corpusCards } from "../domain/corpus";
import { env } from "./env";
import { allEvents, currentRulebook, ownedRun, toSummary } from "./repository";
import { closeIfStale, startRun } from "./runs";
import { readSieveToken, type SieveClaims } from "./toolkit/mcp-token";
import type { Visitor } from "./visitor";

/** The rate-limit identity of the shared NAME_EXTRACTION_MCP_TOKEN. */
const EXTERNAL_VISITOR = "mcp-external";

type Caller = { owner: Owner; visitor: Visitor };

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

function callerOf(ctx: unknown): Caller {
  const caller = (ctx as ToolContext).http?.authInfo?.extra?.caller as
    | Caller
    | undefined;
  if (!caller) throw new Error("Not authorised");
  return caller;
}

function result(data: unknown, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function registerNameExtractionTools(server: McpServer) {
  server.registerTool(
    "list_corpus",
    {
      title: "List the Corpus",
      description:
        "The synthetic AML Documents (fictional Republic of Meridia) Sieve can run on, with page counts, genre, split and how many Names their Answer key holds.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) => {
      callerOf(ctx);
      return result({ documents: corpusCards() });
    },
  );

  server.registerTool(
    "extract_names",
    {
      title: "Extract names",
      description:
        "Starts a Sieve Run: one Analyst lists every party a Document names, with aliases and pages. Give a corpusId (from list_corpus) or an uploadId. Returns a runId at once; poll get_run for progress and the Register.",
      inputSchema: z.object({
        corpusId: z.string().max(40).optional(),
        uploadId: z.string().uuid().optional(),
        analystModel: z.enum(MODEL_IDS as [ModelId, ...ModelId[]]).optional(),
        readerModel: z.enum(MODEL_IDS as [ModelId, ...ModelId[]]).optional(),
      }),
    },
    async (args, ctx) => {
      const caller = callerOf(ctx);
      if (Boolean(args.corpusId) === Boolean(args.uploadId))
        return failure("Give exactly one of corpusId or uploadId.");
      const started = await startRun({
        owner: caller.owner,
        visitor: caller.visitor,
        source: args.corpusId
          ? { kind: "corpus", corpusId: args.corpusId }
          : { kind: "upload", uploadId: args.uploadId as string },
        ...(args.analystModel || args.readerModel
          ? {
              models: {
                analyst: args.analystModel ?? "openai/gpt-6.1-terra",
                reader: args.readerModel ?? "anthropic/claude-haiku-5.5",
              },
            }
          : {}),
      });
      if ("error" in started) return failure(started.error);
      return result(
        { runId: started.runId, status: "running" },
        `Started run ${started.runId}. Poll get_run for progress.`,
      );
    },
  );

  server.registerTool(
    "get_run",
    {
      title: "Get a run",
      description:
        "A Run's status, cost, Score (on Corpus Documents), the Register so far and the last events of its Audit trail.",
      inputSchema: z.object({
        runId: z.string().uuid(),
        events: z
          .number()
          .int()
          .min(0)
          .max(200)
          .optional()
          .describe("How many of the latest events to include (default 30)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      const caller = callerOf(ctx);
      const found = await ownedRun(caller.owner, args.runId);
      if (!found) return failure("No such run.");
      const run = await closeIfStale(found);
      const events = await allEvents(run.id);
      const latestNames = [...events]
        .reverse()
        .find((event) => event.type === "names");
      const names =
        Array.isArray(run.names) && run.names.length > 0
          ? run.names
          : latestNames?.type === "names"
            ? latestNames.names
            : [];
      return result({
        ...toSummary(run),
        names,
        events: events.slice(-(args.events ?? 30)),
      });
    },
  );

  server.registerTool(
    "get_rulebook",
    {
      title: "Get the Rulebook",
      description:
        "The current Rulebook of extraction (entity types, thresholds, exclusions, instructions) and its version.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) => result(await currentRulebook(callerOf(ctx).owner)),
  );
}

const handler = createMcpHandler(registerNameExtractionTools, {
  serverInfo: { name: "sieve", version: "1.0.0" },
});

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a signed token's holder still has Access: a live Guest pass, a Host still on the list. */
async function stillAllowed(claims: SieveClaims) {
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

/**
 * The Sieve MCP server. A bearer is either a token minted for an Owner
 * (`mintMcpToken`, checked against the Owner's Access on every call) or the
 * shared NAME_EXTRACTION_MCP_TOKEN, which acts as the `e2e` Owner under the
 * normal rate limits.
 */
export const mcpHandler = withMcpAuth(
  handler,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const claims = readSieveToken(bearer, env.rateLimitSalt());
    if (claims) {
      if (!(await stillAllowed(claims))) return undefined;
      return {
        token: bearer,
        clientId: `sieve-${claims.kind}`,
        scopes: ["name-extraction"],
        extra: {
          caller: {
            owner: claims.owner,
            visitor: { hash: claims.visitor, trusted: claims.kind === "e2e" },
          } satisfies Caller,
        },
      };
    }
    const external = env.mcpToken();
    if (external && sameSecret(bearer, external)) {
      return {
        token: bearer,
        clientId: "sieve-external",
        scopes: ["name-extraction"],
        extra: {
          caller: {
            owner: "e2e",
            visitor: { hash: EXTERNAL_VISITOR, trusted: false },
          } satisfies Caller,
        },
      };
    }
    return undefined;
  },
  { required: true },
);
