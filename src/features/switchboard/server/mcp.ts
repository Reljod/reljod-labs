import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import { scenarioSchema, type SupervisorStreamPart } from "../domain/contract";
import { detectLanguage } from "../domain/hearing";
import { LIMITS } from "../domain/limits";
import { ruleDefinition, renderRule } from "../domain/rules";
import { BACK_OFFICE_TOOLS } from "../domain/tools";
import { readMcpToken, type SwitchboardClaims } from "../domain/token";
import { RECORD_KINDS } from "../domain/world";
import { callTool, endCall, loadCall, startCall } from "./calls";
import { sql } from "./db";
import { digestOf } from "./digest";
import { env } from "./env";
import { messageOf, StateError } from "./errors";
import { greet, takeTurn } from "./line";
import type { Visitor } from "./rate";
import { restoreRule, rulesView, saveRule } from "./rules";
import {
  emit,
  ensureWorkspace,
  listCalls,
  listRecords,
  liveCallRows,
  resetRecords,
} from "./store";
import { askSupervisor } from "./supervisor";

/**
 * The Switchboard MCP server: the railway's Back office and the line itself.
 * It is the one way in. The voice Session's tool calls, the text Line and an
 * outside client all end in `callTool`, so the same Rules, caps and trail
 * apply whoever asks (ADR 0029). An outside client can be the Agent (call the
 * Back office tools on a Call it started, reporting what was said with
 * `record_turn`) or the Caller (`caller_says`, answered by the line's Agent).
 */

type Caller = { owner: Owner; who: Visitor };

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

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

const failure = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

/** Runs a tool body; what it throws becomes the tool's error, never a 500. */
async function guarded(run: () => Promise<unknown>) {
  try {
    return result(await run());
  } catch (error) {
    return failure(messageOf(error));
  }
}

/** The Call a tool acts on: the one named, or the Owner's live one. */
async function callIdFor(owner: Owner, callId?: string) {
  if (callId) return callId;
  const [live] = await liveCallRows(owner);
  if (!live) throw new StateError("No Call is live. Start one with start_call.");
  return live.id;
}

const callIdArg = z
  .string()
  .uuid()
  .optional()
  .describe("The Call; leave out for the live one");

let toolSeq = 0;

export function registerSwitchboardTools(server: McpServer) {
  // The Back office: one MCP tool per Back office tool, the same definitions the Session is given.
  for (const [name, spec] of Object.entries(BACK_OFFICE_TOOLS)) {
    server.registerTool(
      name,
      {
        title: spec.title,
        description: `${spec.description} Acts inside a live Call; the Call's Rules are checked on every call.`,
        inputSchema: spec.input.extend({
          callId: callIdArg,
          saying: z
            .string()
            .max(LIMITS.transcriptChars)
            .optional()
            .describe(
              "What you, as the Agent, are saying in this Turn (a Disclosure must be said before some tools)",
            ),
        }),
        annotations: { readOnlyHint: !spec.writes },
      },
      async (args: Record<string, unknown>, ctx: unknown) =>
        guarded(async () => {
          const caller = callerOf(ctx);
          const { callId, saying, ...rest } = args;
          const outcome = await callTool({
            owner: caller.owner,
            who: caller.who,
            callId: await callIdFor(caller.owner, callId as string | undefined),
            toolCallId: `mcp-${Date.now()}-${++toolSeq}`,
            name,
            args: rest,
            saying: typeof saying === "string" ? saying : undefined,
          });
          return { ok: outcome.ok, summary: outcome.summary, ...outcome.output };
        }),
    );
  }

  server.registerTool(
    "start_call",
    {
      title: "Start a Call",
      description:
        "Starts a Call on the text Line (ends any live one). The Agent greets first. Then either play the Caller with caller_says, or be the Agent yourself with the Back office tools and record_turn.",
      inputSchema: z.object({
        scenario: scenarioSchema.optional(),
        stub: z
          .boolean()
          .optional()
          .describe("Tests only: canned Agent Turns, honoured for the e2e Owner alone"),
      }),
    },
    async (args, ctx) =>
      guarded(async () => {
        const caller = callerOf(ctx);
        const call = await startCall({
          owner: caller.owner,
          who: caller.who,
          line: "text",
          origin: "mcp",
          scenario: args.scenario ?? { kind: "open" },
          consentAudio: false,
          stub: Boolean(args.stub) && caller.who.trusted,
        });
        const greeting = await greet(caller.owner, call.id);
        return {
          callId: call.id,
          deadlineAt: call.deadlineAt,
          agent: greeting.data.text,
        };
      }),
  );

  server.registerTool(
    "caller_says",
    {
      title: "Say something as the Caller",
      description:
        "One Caller Turn on the live Call. The line's Agent answers, using the Back office under its Rules. Returns what it said and what its tools did.",
      inputSchema: z.object({
        text: z.string().min(1).max(LIMITS.turnChars),
        callId: callIdArg,
      }),
    },
    async (args, ctx) =>
      guarded(async () => {
        const caller = callerOf(ctx);
        const callId = await callIdFor(caller.owner, args.callId);
        let agent = "";
        const tools: unknown[] = [];
        for await (const part of takeTurn({
          owner: caller.owner,
          who: caller.who,
          callId,
          text: args.text,
          via: "mcp",
        })) {
          if (part.kind === "delta") agent += part.text;
          else if (part.kind === "error") throw new Error(part.message);
          else if (part.kind === "event" && part.event.type === "tool.result")
            tools.push({
              name: part.event.data.name,
              ok: part.event.data.ok,
              summary: part.event.data.summary,
              refusedBy: part.event.data.refusal.map(
                (hit) => `${hit.ruleId}@v${hit.version}`,
              ),
            });
        }
        return { callId, agent: agent.trim(), tools };
      }),
  );

  server.registerTool(
    "record_turn",
    {
      title: "Record a Turn",
      description:
        "When you are the Agent on a Call you started: adds what was said to the transcript, so the Checks that read it (Disclosures, authority claims) and the Scorecard see it.",
      inputSchema: z.object({
        who: z.enum(["caller", "agent"]),
        text: z.string().min(1).max(LIMITS.transcriptChars),
        callId: callIdArg,
      }),
    },
    async (args, ctx) =>
      guarded(async () => {
        const caller = callerOf(ctx);
        const callId = await callIdFor(caller.owner, args.callId);
        const { call } = await loadCall(caller.owner, callId);
        if (call.status !== "live") throw new StateError("That Call is over.");
        const atMs = Date.now() - Date.parse(call.startedAt);
        const language = detectLanguage(args.text);
        if (args.who === "caller")
          await emit(sql(), caller.owner, callId, "caller", "turn.caller", {
            text: args.text,
            language,
            via: "mcp",
            atMs,
          });
        else
          await emit(sql(), caller.owner, callId, "client", "turn.agent", {
            text: args.text,
            language,
            atMs,
            interrupted: false,
          });
        return { recorded: true };
      }),
  );

  server.registerTool(
    "end_call",
    {
      title: "End the Call",
      description:
        "Hangs up. The Wrap-up (summary, Scorecard, follow-ups) starts as a durable Workflow; read it with get_call a few seconds later.",
      inputSchema: z.object({ callId: callIdArg }),
    },
    async (args, ctx) =>
      guarded(async () => {
        const caller = callerOf(ctx);
        const call = await endCall({
          owner: caller.owner,
          callId: await callIdFor(caller.owner, args.callId),
          by: "client",
        });
        return { callId: call.id, status: call.status };
      }),
  );

  server.registerTool(
    "get_call",
    {
      title: "Get a Call",
      description:
        "A Call's transcript, tool calls, Refusals and, once written, its Wrap-up and Scorecard.",
      inputSchema: z.object({ callId: z.string().uuid() }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      guarded(async () => {
        const { call, events } = await loadCall(callerOf(ctx).owner, args.callId);
        return {
          ...digestOf(call, events),
          wrapupStatus: call.wrapupStatus,
          wrapup: call.wrapup,
        };
      }),
  );

  server.registerTool(
    "list_calls",
    {
      title: "List Calls",
      description: "The Owner's saved Calls, newest first.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      guarded(async () => ({ calls: await listCalls(callerOf(ctx).owner) })),
  );

  server.registerTool(
    "list_records",
    {
      title: "List Back office Records",
      description:
        "What the Back office holds for this Owner: bookings, disruptions, refunds and vouchers, lost property, assistance, hand-offs, callbacks, confirmations.",
      inputSchema: z.object({ kind: z.enum(RECORD_KINDS).optional() }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      guarded(async () => {
        const records = await listRecords(callerOf(ctx).owner);
        return {
          records: records.filter((record) => !args.kind || record.kind === args.kind),
        };
      }),
  );

  server.registerTool(
    "reset_back_office",
    {
      title: "Reset the Back office",
      description:
        "Puts the Records back to the seed. Calls, Rules and the trail are kept.",
      inputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    async (_args, ctx) =>
      guarded(async () => {
        await resetRecords(callerOf(ctx).owner);
        return { reset: true };
      }),
  );

  server.registerTool(
    "list_rules",
    {
      title: "List the Rules",
      description:
        "The Rulebook in force: each Rule's id, Version, whether it is on, its Parameters and its sentence.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      guarded(async () => {
        const { rulebook } = await rulesView(callerOf(ctx).owner);
        return {
          rules: rulebook.map((rule) => ({
            ...rule,
            title: ruleDefinition(rule.id)?.title,
            sentence: renderRule(rule),
          })),
        };
      }),
  );

  server.registerTool(
    "save_rule",
    {
      title: "Edit a Rule",
      description:
        "Saves a new Version of a Rule (Parameters not given keep their Default). The next Call starts under it. `restore: true` puts the Default back.",
      inputSchema: z.object({
        ruleId: z.string().max(60),
        enabled: z.boolean().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        note: z.string().max(200).optional(),
        restore: z.boolean().optional(),
      }),
    },
    async (args, ctx) =>
      guarded(async () => {
        const { owner } = callerOf(ctx);
        if (args.restore) return restoreRule(owner, args.ruleId);
        const { rulebook } = await rulesView(owner);
        const current = rulebook.find((rule) => rule.id === args.ruleId);
        return saveRule({
          owner,
          ruleId: args.ruleId,
          enabled: args.enabled ?? current?.enabled ?? true,
          params: { ...current?.params, ...args.params },
          note: args.note,
        });
      }),
  );

  server.registerTool(
    "ask_supervisor",
    {
      title: "Ask in Supervisor mode",
      description:
        "Asks the Agent about past Calls. It answers numbers by running code in a Sandbox with no network over the last Calls.",
      inputSchema: z.object({ question: z.string().min(1).max(LIMITS.turnChars) }),
    },
    async (args, ctx) =>
      guarded(async () => {
        const caller = callerOf(ctx);
        let answer = "";
        const code: SupervisorStreamPart[] = [];
        for await (const part of askSupervisor({ ...caller, question: args.question })) {
          if (part.kind === "delta") answer += part.text;
          else if (part.kind === "code" || part.kind === "code_result") code.push(part);
          else if (part.kind === "error") throw new Error(part.message);
        }
        return { answer, code };
      }),
  );
}

const handler = createMcpHandler(registerSwitchboardTools, {
  serverInfo: { name: "switchboard", version: "1.0.0" },
});

/** Whether a signed token's holder still has Access: a live Guest pass, a Host still on the list. */
async function stillAllowed(claims: SwitchboardClaims) {
  switch (claims.kind) {
    case "e2e":
      return Boolean(env.e2eBypassToken());
    case "host":
      return Boolean(claims.email && accessEnv.hostEmails().includes(claims.email));
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
 * The only bearer is a token minted for an Owner under "Connect a client",
 * checked against that Owner's Access on every call. There is no shared
 * token.
 */
export const mcpHandler = withMcpAuth(
  handler,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const claims = readMcpToken(bearer, env.rateLimitSalt());
    if (!claims || !(await stillAllowed(claims))) return undefined;
    await ensureWorkspace(claims.owner);
    return {
      token: bearer,
      clientId: `switchboard-${claims.kind}`,
      scopes: ["switchboard"],
      extra: {
        caller: {
          owner: claims.owner,
          who: { hash: claims.visitor, trusted: claims.kind === "e2e" },
        } satisfies Caller,
      },
    };
  },
  { required: true },
);
