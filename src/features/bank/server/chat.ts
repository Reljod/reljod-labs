import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, streamText, type ToolSet, tool } from "ai";
import { z } from "zod";
import { auditIn } from "../core/audit";
import { InvalidError } from "../core/errors";
import { listConfirmations } from "../core/reads";
import { BANK_MCP_PATH } from "../domain/api";
import {
  type ChatEvent,
  cutArgs,
  historyOf,
  instructionsFor,
  partsOf,
  type SessionSummary,
  stubPlan,
  titleFrom,
  toolData,
  toolOk,
  toolSummary,
} from "../domain/chat";
import type { BankDate } from "../domain/dates";
import { LIMITS } from "../domain/limits";
import { ROLE_LABEL } from "../domain/staff";
import type { CustomerDetail, CustomerSummary } from "../domain/views";
import { SKILLS, skillById } from "../skills";
import { read } from "./bank";
import { actorOf, type StaffContext } from "./context";
import { sql } from "./db";
import { env } from "./env";
import { addUsage, gateway, type Usage, usageOf, visibleThinking } from "./llm";
import { mcpHandler } from "./mcp";
import { chatToken } from "./mcp-auth";
import { takeRate } from "./rate";
import { customerFiles, runCode } from "./sandbox";
import {
  appendMessage,
  listMessages,
  ownedSession,
  setSession,
} from "./sessions";

/*
 * One chat turn. The Teller reaches the bank only through the bank's MCP
 * server, called in process with a ten-minute token for the Session's Staff
 * member; its only local tools are `load_skill` and `run_code`. The harness
 * (this file and the engine behind the MCP server) owns the caps, the
 * permissions and the confirmation gate. The model owns none of them.
 */

const LOAD_SKILL = "load_skill";
const RUN_CODE = "run_code";

export type TurnInput = {
  context: StaffContext;
  sessionId: string;
  text: string;
  origin: string;
  /** e2e only: a canned turn that still calls a real tool, no model spend. */
  stubbed: boolean;
};

export type PreparedTurn = TurnInput & {
  session: SessionSummary;
  renamed: boolean;
  history: { role: "user" | "assistant"; content: string }[];
};

/** Everything before the stream: the Session is the Owner's, the message passes the caps and is saved. */
export async function prepareTurn(input: TurnInput): Promise<PreparedTurn> {
  const { context } = input;
  const text = input.text.trim();
  if (!text) throw new InvalidError("Say something first.");
  if (text.length > LIMITS.messageChars) {
    throw new InvalidError(
      `A message is at most ${LIMITS.messageChars} characters.`,
    );
  }
  const before = await ownedSession(context.owner, input.sessionId);
  await takeRate(context.visitor, context.owner, "message");
  const earlier = await listMessages(context.owner, before.id);
  await appendMessage({
    owner: context.owner,
    sessionId: before.id,
    role: "person",
    content: text,
  });
  const first = earlier.length === 0;
  const session = first
    ? await setSession(context.owner, before.id, { title: titleFrom(text) })
    : before;
  return {
    ...input,
    text,
    session,
    renamed: first,
    history: historyOf(earlier),
  };
}

function mcpClient(turn: PreparedTurn) {
  return createMCPClient({
    transport: {
      type: "http",
      url: `${turn.origin}${BANK_MCP_PATH}`,
      headers: {
        authorization: `Bearer ${chatToken(turn.context, turn.session.id)}`,
      },
      // In process: no network hop, the same handler outside clients reach.
      fetch: (url, init) => mcpHandler(new Request(url, init)),
    },
  });
}

async function finish(
  turn: PreparedTurn,
  content: string,
  events: ChatEvent[],
  usage: Usage | null,
): Promise<ChatEvent> {
  const messageId = await appendMessage({
    owner: turn.context.owner,
    sessionId: turn.session.id,
    role: "teller",
    content,
    parts: partsOf(events),
    usage,
  });
  return { type: "done", messageId };
}

type Execute = (
  args: Record<string, unknown>,
  options: { toolCallId: string; messages: [] },
) => Promise<unknown>;

/** The e2e suite's turn: the same events and saves, one real MCP tool call, no model. */
async function* stubTurn(turn: PreparedTurn): AsyncGenerator<ChatEvent> {
  const events: ChatEvent[] = [];
  const emit = (event: ChatEvent) => {
    events.push(event);
    return event;
  };
  const plan = stubPlan(turn.text);
  let said = "";
  if (plan) {
    const mcp = await mcpClient(turn);
    try {
      const tools = (await mcp.tools()) as unknown as ToolSet;
      let args: Record<string, unknown> = {};
      if (plan.needs === "transfer") {
        const actor = actorOf(turn.context);
        const { customers } = (await read(actor, "list_customers", {})) as {
          customers: CustomerSummary[];
        };
        const detail = async (name: string) =>
          (await read(actor, "get_customer", {
            customerId: customers.find((customer) => customer.name === name)
              ?.id,
          })) as CustomerDetail;
        const [mara, joren] = [
          await detail("Mara Voss"),
          await detail("Joren Pike"),
        ];
        args = {
          fromAccountId: mara.accounts.find(
            (account) => account.kind === "current",
          )?.id,
          toAccountNumber: joren.accounts.find(
            (account) => account.kind === "current",
          )?.number,
          amount: 12_00,
          reference: "Stubbed by the e2e suite",
        };
      } else if (plan.name === "raise_request") {
        args = {
          kind: "feature",
          title: turn.text.slice(0, 80),
          want: `The person said: "${turn.text.slice(0, 400)}"`,
        };
      }
      const execute = tools[plan.name]?.execute as unknown as
        | Execute
        | undefined;
      if (execute) {
        const id = `stub-${crypto.randomUUID()}`;
        yield emit({
          type: "tool.started",
          id,
          name: plan.name,
          args: cutArgs(args),
        });
        const output = await execute(args, { toolCallId: id, messages: [] });
        yield emit({
          type: "tool.finished",
          id,
          name: plan.name,
          ok: toolOk(output),
          summary: toolSummary(plan.name, output),
          data: toolData(output),
        });
        said = ` Called ${plan.name}: ${toolSummary(plan.name, output)}`;
      }
    } finally {
      await mcp.close().catch(() => {});
    }
  }
  const reply = `(Stubbed Teller, no model.)${said}`;
  for (const word of reply.split(/(?<= )/))
    yield emit({ type: "text.delta", text: word });
  yield {
    type: "usage",
    model: "stub",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
  yield await finish(turn, reply, events, null);
}

/** The Teller's answer to a prepared turn, as ChatEvents. Ends with `done`, or throws. */
export async function* streamTurn(
  turn: PreparedTurn,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  if (turn.renamed) yield { type: "session", session: turn.session };
  if (turn.stubbed) {
    yield* stubTurn(turn);
    return;
  }
  const { context } = turn;
  const { owner, staff } = context;
  const actor = actorOf(context, "chat", turn.session.id);
  const sessionId = turn.session.id;
  const model = env.chatModel();
  const db = sql();

  const opening = mcpClient(turn);
  let mcp: Awaited<typeof opening>;
  let mcpTools: ToolSet;
  let brief: Parameters<typeof instructionsFor>[0];
  try {
    const [client, customers, pending, clock] = await Promise.all([
      opening,
      read(actorOf(context), "list_customers", {}) as Promise<{
        customers: CustomerSummary[];
      }>,
      listConfirmations(db, owner, { sessionId }),
      db<{ today: BankDate }[]>`select bank.today(${owner}) as today`,
    ]);
    mcp = client;
    mcpTools = (await client.tools()) as unknown as ToolSet;
    const focus = customers.customers.find(
      (customer) => customer.id === turn.session.customerId,
    );
    brief = {
      staffName: staff.name,
      staffRole: ROLE_LABEL[staff.role],
      bankDate: clock[0]?.today ?? "",
      customers: customers.customers.map(({ id, name, number, kycStatus }) => ({
        id,
        name,
        number,
        kycStatus,
      })),
      focus: focus ? { id: focus.id, name: focus.name } : null,
      skills: SKILLS.map(({ id, name, description }) => ({
        id,
        name,
        description,
      })),
      confirmations: pending.confirmations.slice(0, 8).map((item) => ({
        summary: item.summary,
        status: item.status,
        result: item.resultMessage,
      })),
      sandbox: env.sandboxConfigured(),
    };
  } catch (error) {
    void opening.then((client) => client.close()).catch(() => {});
    throw error;
  }

  const events: ChatEvent[] = [];
  const emit = (event: ChatEvent) => {
    events.push(event);
    return event;
  };
  /** What the local tools did, by tool call, for the chat's cards. */
  const local = new Map<
    string,
    { ok: boolean; summary: string; data: unknown }
  >();
  let text = "";
  let aborted = false;

  try {
    const tools: ToolSet = {
      ...mcpTools,
      [LOAD_SKILL]: tool({
        description:
          "Loads one of the Teller's Skills (by the id in your instructions) and returns its SKILL.md. Load a Skill before a task it describes.",
        inputSchema: z.object({ skillId: z.string().min(1).max(60) }),
        execute: async ({ skillId }, { toolCallId }) => {
          const skill = skillById(skillId);
          if (!skill) {
            local.set(toolCallId, {
              ok: false,
              summary: `No Skill "${skillId}"`,
              data: null,
            });
            return `There is no Skill "${skillId}".`;
          }
          local.set(toolCallId, {
            ok: true,
            summary: `Loaded the ${skill.name} Skill`,
            data: { skill: skill.name },
          });
          await auditIn(
            db,
            { actor },
            {
              action: "teller.skill_loaded",
              summary: `Loaded the ${skill.name} Skill`,
              target: { kind: "skill", id: skill.id },
            },
          );
          return skill.body;
        },
      }),
      [RUN_CODE]: tool({
        description:
          "Runs one Node.js (ESM) script in a sandbox with no network, for analysis. Give customerId and the bank writes that customer's data under data/ first (see the sandbox-analysis Skill). Returns stdout, stderr and the exit code. It cannot change the bank.",
        inputSchema: z.object({
          customerId: z
            .string()
            .uuid()
            .describe("Whose data to write into the sandbox"),
          code: z.string().min(1).max(12_000),
          purpose: z
            .string()
            .max(120)
            .describe("One line: what the code works out"),
        }),
        execute: async ({ customerId, code, purpose }, { toolCallId }) => {
          // The cap and the trail come first: no command runs uncounted or untraced.
          await takeRate(context.visitor, owner, "sandbox");
          await auditIn(
            db,
            { actor },
            {
              action: "teller.code_ran",
              summary: `Sandbox: ${purpose}`,
              target: { kind: "customer", id: customerId },
              detail: { codeChars: code.length, purpose },
            },
          );
          const files = await customerFiles(
            actorOf(context, "chat", sessionId),
            customerId,
          );
          const result = await runCode({
            sessionId,
            callId: toolCallId,
            code,
            files,
          });
          local.set(toolCallId, {
            ok: result.exitCode === 0,
            summary:
              result.exitCode === 0
                ? `Ran code: ${purpose}`
                : `Code failed (exit ${result.exitCode})`,
            data: { code, purpose, ...result },
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            files: result.files,
          };
        },
      }),
    };

    const result = streamText({
      model: gateway()(model),
      instructions: instructionsFor(brief),
      tools,
      providerOptions: {
        ...visibleThinking(model),
        gateway: { caching: "auto" },
      },
      stopWhen: isStepCount(LIMITS.stepsPerChatTurn),
      abortSignal: signal,
      messages: [
        ...turn.history,
        { role: "user" as const, content: turn.text },
      ],
    });

    const names = new Map<string, string>();
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        yield emit({ type: "text.delta", text: part.text });
      } else if (part.type === "reasoning-delta") {
        yield emit({ type: "reasoning.delta", text: part.text });
      } else if (part.type === "tool-call") {
        names.set(part.toolCallId, part.toolName);
        yield emit({
          type: "tool.started",
          id: part.toolCallId,
          name: part.toolName,
          args: cutArgs(part.input),
        });
      } else if (part.type === "tool-result") {
        const own = local.get(part.toolCallId);
        const ok = own ? own.ok : toolOk(part.output);
        const summary = own
          ? own.summary
          : toolSummary(part.toolName, part.output);
        yield emit({
          type: "tool.finished",
          id: part.toolCallId,
          name: part.toolName,
          ok,
          summary,
          data: own ? own.data : toolData(part.output),
        });
        if (!own) {
          // The command wrote its own Audit event; this one records that the Teller asked.
          await auditIn(
            db,
            { actor },
            {
              action: "teller.tool_called",
              summary: `${part.toolName}: ${summary}`.slice(0, 300),
              detail: { tool: part.toolName, ok },
            },
          );
        }
      } else if (part.type === "tool-error") {
        yield emit({
          type: "tool.finished",
          id: part.toolCallId,
          name: names.get(part.toolCallId) ?? part.toolName,
          ok: false,
          summary: "The tool failed",
          data: null,
        });
      } else if (part.type === "abort") {
        aborted = true;
      } else if (part.type === "error") {
        throw part.error instanceof Error
          ? part.error
          : new Error("The model call failed.");
      }
    }

    // Recorded even when stopped: the steps that ran were paid for.
    const steps = await Promise.resolve(result.steps).catch(() => []);
    const usage = addUsage(
      steps.map((step) =>
        usageOf({
          model,
          usage: step.usage,
          providerMetadata: step.providerMetadata,
        }),
      ),
    );
    if (usage) {
      yield emit({ type: "usage", ...usage });
      await auditIn(
        db,
        { actor },
        {
          action: "teller.model_called",
          summary: `Answered with ${usage.model} in ${steps.length} step(s)`,
          detail: {
            steps: steps.length,
            tools: events.filter((event) => event.type === "tool.started")
              .length,
          },
          usage,
        },
      );
    }
    yield await finish(
      turn,
      aborted ? `${text.trim()} (stopped)`.trim() : text.trim(),
      events,
      usage,
    );
  } catch (error) {
    if (!signal.aborted) throw error;
    await finish(turn, `${text.trim()} (stopped)`.trim(), events, null).catch(
      () => null,
    );
  } finally {
    await mcp.close().catch(() => {});
  }
}
