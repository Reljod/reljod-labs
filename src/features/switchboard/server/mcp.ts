import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { scenarioSchema } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { renderRule, ruleDefinition } from "../domain/rules";
import { BACK_OFFICE_TOOLS } from "../domain/tools";
import { RECORD_KINDS } from "../domain/world";
import { switchboard } from "./container";
import { digestOf } from "./digest";
import type { Caller } from "./ports";
import type { SwitchboardServices } from "./services";

/**
 * The Switchboard MCP server: the railway's Back office and the line itself.
 * The voice Session's tool calls, the text Line and an outside client all
 * end in the Calls service's `tool`, so the same Rules, caps and trail apply
 * whoever asks (ADR 0029). An outside client can be the Agent (call the Back
 * office tools on a Call it started, reporting what was said with
 * `record_turn`) or the Caller (`caller_says`, answered by the line's Agent).
 */

type Session = { caller: Caller; services: SwitchboardServices };

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

/** Who the verified token acts for, and the services its mode reaches. */
function sessionOf(ctx: unknown): Session {
  const extra = (ctx as ToolContext).http?.authInfo?.extra;
  const caller = extra?.caller as Caller | undefined;
  if (!caller) throw new Error("Not authorised");
  return { caller, services: switchboard({ stub: extra?.stub === true }) };
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
async function guarded(
  ctx: unknown,
  run: (session: Session) => Promise<unknown>,
) {
  try {
    return result(await run(sessionOf(ctx)));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
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
        guarded(ctx, async ({ caller, services }) => {
          const { callId, saying, ...rest } = args;
          const outcome = await services.calls.tool(
            caller,
            await services.calls.callIdFor(
              caller.owner,
              callId as string | undefined,
            ),
            {
              toolCallId: `mcp-${Date.now()}-${++toolSeq}`,
              name,
              args: rest,
              saying: typeof saying === "string" ? saying : undefined,
            },
          );
          return {
            ok: outcome.ok,
            summary: outcome.summary,
            ...outcome.output,
          };
        }),
    );
  }

  server.registerTool(
    "start_call",
    {
      title: "Start a Call",
      description:
        "Starts a Call on the text Line (ends any live one). The Agent greets first. Then either play the Caller with caller_says, or be the Agent yourself with the Back office tools and record_turn.",
      inputSchema: z.object({ scenario: scenarioSchema.optional() }),
    },
    async (args, ctx) =>
      guarded(ctx, async ({ caller, services }) => {
        const { call, events } = await services.calls.start(caller, {
          line: "text",
          origin: "mcp",
          scenario: args.scenario ?? { kind: "open" },
        });
        const greeting = events.find((event) => event.type === "turn.agent");
        return {
          callId: call.id,
          deadlineAt: call.deadlineAt,
          agent: greeting?.type === "turn.agent" ? greeting.data.text : "",
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
      guarded(ctx, async ({ caller, services }) => {
        const callId = await services.calls.callIdFor(
          caller.owner,
          args.callId,
        );
        let agent = "";
        const tools: unknown[] = [];
        for await (const part of await services.calls.turn(
          caller,
          callId,
          args.text,
          "mcp",
        )) {
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
      guarded(ctx, async ({ caller, services }) => {
        await services.calls.recordTurn(
          caller,
          await services.calls.callIdFor(caller.owner, args.callId),
          args.who,
          args.text,
        );
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
      guarded(ctx, async ({ caller, services }) => {
        const { call } = await services.calls.end(
          caller,
          await services.calls.callIdFor(caller.owner, args.callId),
          "client",
        );
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
      guarded(ctx, async ({ caller, services }) => {
        const { call, events } = await services.calls.get(
          caller.owner,
          args.callId,
        );
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
      guarded(ctx, async ({ caller, services }) => ({
        calls: await services.calls.list(caller.owner),
      })),
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
      guarded(ctx, async ({ caller, services }) => ({
        records: await services.office.records(caller.owner, args.kind),
      })),
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
      guarded(ctx, async ({ caller, services }) => {
        await services.office.reset(caller.owner);
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
      guarded(ctx, async ({ caller, services }) => {
        const { rulebook } = await services.rules.view(caller.owner);
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
      guarded(ctx, async ({ caller, services }) => {
        const { restore, ...edit } = args;
        return restore
          ? services.rules.restore(caller.owner, args.ruleId)
          : services.rules.amend(caller.owner, edit);
      }),
  );
}

const handler = createMcpHandler(registerSwitchboardTools, {
  serverInfo: { name: "switchboard", version: "1.0.0" },
});

/**
 * The only bearer is a token minted for an Owner under "Connect a client",
 * checked against that Owner's Access on every call (`connect.authenticate`).
 * There is no shared token. A token the stubbed e2e suite minted reaches the
 * stubbed services.
 */
export const mcpHandler = withMcpAuth(
  handler,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const session = await switchboard().connect.authenticate(bearer);
    if (!session) return undefined;
    return {
      token: bearer,
      clientId: `switchboard-${session.kind}`,
      scopes: ["switchboard"],
      extra: { caller: session.caller, stub: session.stub },
    };
  },
  { required: true },
);
