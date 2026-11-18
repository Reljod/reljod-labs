import "server-only";
import {
  createGateway,
  generateText,
  type LanguageModelUsage,
  type ModelMessage,
  tool,
} from "ai";
import { z } from "zod";
import {
  ACTION_KEYS,
  ACTION_LIMITS,
  type ScreenAction,
  screenActionSchema,
} from "../domain/actions";
import { estimateCost } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { rulebookText } from "../domain/rules";
import { sampleTask } from "../domain/tasks";
import { GEOMETRY } from "../legacy/types";
import { SKILL_IDS, SKILLS } from "../skills";
import { CODE_LIMITS } from "./code-sandbox";
import type { RunContext } from "./context";
import { env } from "./env";
import { runStatus } from "./repository";
import { getFrame } from "./storage";

/*
 * The Operator: one agent, one model call per Turn (ADR 0025). It is shown
 * the Screen as a picture and answers with tool calls that do not execute
 * here: the workflow runs each as its own step, through the Guard.
 */

export type ToolCall = { toolCallId: string; toolName: string; input: unknown };

/**
 * The conversation as the workflow keeps it: text only. Pictures are named
 * by Frame number and loaded from Storage when a Turn is built, so they
 * never travel through the workflow's own log.
 */
export type TranscriptItem =
  | { role: "assistant"; text: string; calls: ToolCall[] }
  | {
      role: "results";
      results: { toolCallId: string; toolName: string; output: string }[];
      /** The Frame that shows the Screen after these calls. */
      frame: number | null;
      /** One line that stands in for the picture once it is dropped. */
      hint: string;
    }
  | { role: "note"; text: string };

/** How many of the latest pictures the Operator still sees. Older ones become one line each. */
const PICTURES_KEPT = 2;
const OUTPUT_TOKENS = 2500;

// The tools, as the model sees them -------------------------------------------------------

const TOOL_SCHEMAS = {
  screen_click: z.object({
    x: z
      .number()
      .int()
      .describe(`Pixels from the left, 0 to ${GEOMETRY.width - 1}`),
    y: z
      .number()
      .int()
      .describe(`Pixels from the top, 0 to ${GEOMETRY.height - 1}`),
  }),
  screen_type: z.object({
    text: z
      .string()
      .describe(
        `Text to type at the cursor, at most ${ACTION_LIMITS.typeChars} characters. It does not press Enter or Tab.`,
      ),
  }),
  screen_key: z.object({
    keys: z
      .array(z.enum(ACTION_KEYS))
      .min(1)
      .max(ACTION_LIMITS.keysPerAction)
      .describe('Keys to press one after another, such as ["Tab"] or ["F10"]'),
  }),
  screen_scroll: z.object({ direction: z.enum(["down", "up"]) }),
  screen_wait: z.object({
    ms: z.number().int().min(100).max(ACTION_LIMITS.waitMs),
  }),
  run_code: z.object({
    code: z
      .string()
      .max(CODE_LIMITS.codeChars)
      .describe(
        "Node.js (ESM). Files in the working directory: task.txt, manifest.txt (if a Manifest is attached), keyed.json (what this Run has changed in the Books so far), iso6346.mjs (normalise, checkDigit, isValid). No network. Print results with console.log.",
      ),
  }),
  load_skill: z.object({ id: z.enum(SKILL_IDS as [string, ...string[]]) }),
  update_plan: z.object({
    items: z
      .array(z.object({ text: z.string().max(140), done: z.boolean() }))
      .max(20),
  }),
  finish_run: z.object({
    summary: z
      .string()
      .max(1500)
      .describe(
        "What you did and anything you could not do. It decides nothing: code checks the Books.",
      ),
  }),
};

export type ToolName = keyof typeof TOOL_SCHEMAS;
export const isToolName = (name: string): name is ToolName =>
  name in TOOL_SCHEMAS;

const DESCRIPTIONS: Record<ToolName, string> = {
  screen_click:
    "Click a pixel of the Screen: a field to put the cursor there, a key in the bottom row, a button in a box.",
  screen_type:
    "Type text at the cursor. Use screen_key for Tab, Enter and function keys.",
  screen_key: "Press one or more keys in order.",
  screen_scroll: "Page a list forward (down) or back (up).",
  screen_wait: "Wait, then look again.",
  run_code: `Run Node.js in a sandbox with no network, for what a clerk would script: parse the Manifest, check container numbers, diff what was keyed. At most ${LIMITS.codeRunsPerRun} runs.`,
  load_skill: "Load a Skill's full text.",
  update_plan:
    "Set your checklist for this Task; the person watching sees it. Send the whole list each time.",
  finish_run: "Say the Task is finished. Sign off first.",
};

function operatorTools() {
  const make = <T extends z.ZodType>(name: ToolName, inputSchema: T) =>
    tool({ description: DESCRIPTIONS[name], inputSchema });
  return {
    screen_click: make("screen_click", TOOL_SCHEMAS.screen_click),
    screen_type: make("screen_type", TOOL_SCHEMAS.screen_type),
    screen_key: make("screen_key", TOOL_SCHEMAS.screen_key),
    screen_scroll: make("screen_scroll", TOOL_SCHEMAS.screen_scroll),
    screen_wait: make("screen_wait", TOOL_SCHEMAS.screen_wait),
    run_code: make("run_code", TOOL_SCHEMAS.run_code),
    load_skill: make("load_skill", TOOL_SCHEMAS.load_skill),
    update_plan: make("update_plan", TOOL_SCHEMAS.update_plan),
    finish_run: make("finish_run", TOOL_SCHEMAS.finish_run),
  };
}

/** The Action a screen tool call asks for, or the reason it is not one. */
export function actionOf(
  toolName: string,
  input: unknown,
): { action: ScreenAction } | { error: string } {
  const value = (input ?? {}) as Record<string, unknown>;
  const candidate =
    toolName === "screen_click"
      ? { type: "click", x: value.x, y: value.y }
      : toolName === "screen_type"
        ? { type: "type", text: value.text }
        : toolName === "screen_key"
          ? { type: "key", keys: value.keys }
          : toolName === "screen_scroll"
            ? { type: "scroll", dy: value.direction === "up" ? -400 : 400 }
            : toolName === "screen_wait"
              ? { type: "wait", ms: value.ms }
              : null;
  if (!candidate) return { error: `Unknown tool ${toolName}.` };
  const parsed = screenActionSchema.safeParse(candidate);
  return parsed.success
    ? { action: parsed.data }
    : {
        error: `Not done: ${parsed.error.issues[0]?.message ?? "the input is not valid"}.`,
      };
}

/** The tool call that asks for an Action: how a Script's Actions are replayed as calls. */
export function callOf(action: ScreenAction, toolCallId: string): ToolCall {
  switch (action.type) {
    case "click":
      return {
        toolCallId,
        toolName: "screen_click",
        input: { x: action.x, y: action.y },
      };
    case "type":
      return {
        toolCallId,
        toolName: "screen_type",
        input: { text: action.text },
      };
    case "key":
      return {
        toolCallId,
        toolName: "screen_key",
        input: { keys: action.keys },
      };
    case "scroll":
      return {
        toolCallId,
        toolName: "screen_scroll",
        input: { direction: action.dy > 0 ? "down" : "up" },
      };
    case "wait":
      return { toolCallId, toolName: "screen_wait", input: { ms: action.ms } };
  }
}

// Instructions ------------------------------------------------------------------------------

export function operatorInstructions(ctx: RunContext) {
  return `You are the Operator. You work HARBOURMASTER, the manifest and berth system of the Port Authority of Meridia: an old terminal application with no API. You do the keying a port clerk would do, by looking at the Screen and using the keyboard and mouse.

How you work
- After every turn you are shown the Screen as a picture, ${GEOMETRY.width} by ${GEOMETRY.height} pixels. It is the only way you see HARBOURMASTER. Read it before you act: the Screen code top left, the message line second from the bottom, the cursor, the keys listed on the bottom row.
- You act with the screen_ tools. One turn may hold several calls when you do not need to look in between: fill a whole form (type, Tab, type, Tab ...) and press the key that saves, at most ${LIMITS.actionsPerTurn} calls. They run in order; you get one picture after the last.
- Start every turn with one short plain sentence saying what you are about to do. The person watching reads it.
- Load the "desk-manual" Skill before you key anything: field widths and formats are not on the Screen, and HARBOURMASTER drops what does not fit without telling you.
- Use run_code for arithmetic, parsing and comparing. Do not do those in your head.
- When the Task is done, sign off, then call finish_run. If you could not do part of it, say so plainly there.

What decides things
- Rules, applied by code, sit between you and HARBOURMASTER. A key that breaks a Rule is refused before it is pressed, and you are told why. A guarded key pauses the Run until the person watching approves or refuses. You cannot approve anything, and you must not try to reach a refused change another way.
- After the Run, code compares HARBOURMASTER's records with the Task. Your summary is a note, not the result. So be exact: key what the Task and the Manifest say, nothing more.

The Rules of this Run (Rulebook version ${ctx.rulebookVersion})
${rulebookText(ctx.rulebook)}

Limits: ${LIMITS.turnsPerRun} turns, ${LIMITS.actionsPerRun} Actions, $${LIMITS.usdPerRun.toFixed(2)} of model spend, about ${LIMITS.sandboxMinutes - 2} minutes.

Skills (load_skill)
${SKILLS.map((skill) => `- ${skill.id}: ${skill.description}`).join("\n")}`;
}

export function operatorBrief(ctx: RunContext) {
  const manifest = ctx.manifest
    ? `\n\nAttached Manifest "${ctx.manifest.name}":\n"""\n${ctx.manifest.text.slice(0, 12_000)}\n"""`
    : "";
  return `The Task:\n${ctx.brief}${manifest}\n\nThe Screen now is in the picture.`;
}

// Building a Turn's messages ------------------------------------------------------------------

async function picture(runId: string, frame: number) {
  const png = await getFrame(runId, frame);
  return png
    ? [{ type: "file" as const, mediaType: "image/png", data: png }]
    : [];
}

/**
 * The model's messages for the next Turn. The latest pictures are attached;
 * each older one is replaced by the line the harness kept for it.
 */
export async function buildMessages(
  ctx: RunContext,
  transcript: TranscriptItem[],
): Promise<ModelMessage[]> {
  // Frame 0 belongs to the brief; every `results` item may carry one more.
  const frames = [
    0,
    ...transcript.flatMap((item) =>
      item.role === "results" && item.frame !== null ? [item.frame] : [],
    ),
  ];
  const kept = new Set(frames.slice(-PICTURES_KEPT));
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: operatorBrief(ctx) },
        ...(kept.has(0)
          ? await picture(ctx.runId, 0)
          : [
              {
                type: "text" as const,
                text: "[The first picture is no longer shown: it was the sign-on Screen HMS000.]",
              },
            ]),
      ],
    },
  ];
  for (const item of transcript) {
    if (item.role === "note") {
      messages.push({ role: "user", content: item.text });
    } else if (item.role === "assistant") {
      messages.push({
        role: "assistant",
        content: [
          ...(item.text ? [{ type: "text" as const, text: item.text }] : []),
          ...item.calls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          })),
        ],
      });
    } else {
      messages.push({
        role: "tool",
        content: item.results.map((result) => ({
          type: "tool-result" as const,
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          output: { type: "text" as const, value: result.output },
        })),
      });
      if (item.frame !== null)
        messages.push({
          role: "user",
          content: kept.has(item.frame)
            ? [
                { type: "text", text: "The Screen now:" },
                ...(await picture(ctx.runId, item.frame)),
              ]
            : `[A picture is no longer shown here. It was ${item.hint}.]`,
        });
    }
  }
  return messages;
}

// One Turn ------------------------------------------------------------------------------------

let gatewayClient: ReturnType<typeof createGateway> | undefined;
const gateway = () => {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
};

/** What a call is worth: the larger of what the gateway charged and its list price, else our estimate. */
export function callCost(
  model: string,
  providerMetadata: unknown,
  tokens: { input: number; output: number; cached: number },
) {
  const meta =
    typeof providerMetadata === "object" && providerMetadata !== null
      ? (providerMetadata as { gateway?: unknown }).gateway
      : undefined;
  let reported: number | null = null;
  if (typeof meta === "object" && meta !== null) {
    const { cost, marketCost } = meta as {
      cost?: unknown;
      marketCost?: unknown;
    };
    for (const value of [cost, marketCost]) {
      const number = typeof value === "string" ? Number(value) : value;
      if (typeof number === "number" && Number.isFinite(number) && number >= 0)
        reported = Math.max(reported ?? 0, number);
    }
  }
  if (reported !== null && (reported > 0 || tokens.input + tokens.output === 0))
    return reported;
  return estimateCost(model, tokens.input, tokens.output, tokens.cached);
}

export type TurnResult =
  | { kind: "over" }
  | {
      kind: "turn";
      text: string;
      calls: ToolCall[];
      usage: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number;
        costUsd: number;
        ms: number;
      } | null;
    };

/** The scripted Operator: the sample Task's Script, one Turn at a time, then finish. */
export function scriptedTurn(ctx: RunContext, turn: number): TurnResult {
  const script =
    (ctx.taskId ? sampleTask(ctx.taskId)?.script : undefined) ?? [];
  const planned = script[turn];
  if (!planned)
    return {
      kind: "turn",
      text: "The Script is played out.",
      calls: [
        {
          toolCallId: `script-${turn}-finish`,
          toolName: "finish_run",
          input: { summary: "Played the sample Task's Script to its end." },
        },
      ],
      usage: null,
    };
  return {
    kind: "turn",
    text: planned.intent,
    calls: planned.actions.map((action, index) =>
      callOf(action, `script-${turn}-${index}`),
    ),
    usage: null,
  };
}

/**
 * One Turn of the Operator: one model call, or the next Turn of the Script
 * for a stubbed Run. A Run whose row says it is over spends nothing more.
 */
export async function operatorTurn(
  ctx: RunContext,
  transcript: TranscriptItem[],
  turn: number,
): Promise<TurnResult> {
  const status = await runStatus(ctx.runId);
  if (status !== "running") return { kind: "over" };
  if (ctx.stubbed) return scriptedTurn(ctx, turn);
  const model = ctx.model ?? "anthropic/claude-sonnet-5.5";
  const started = Date.now();
  const result = await generateText({
    model: gateway()(model),
    reasoning: "low",
    providerOptions: { gateway: { caching: "auto" } },
    instructions: operatorInstructions(ctx),
    messages: await buildMessages(ctx, transcript),
    tools: operatorTools(),
    maxOutputTokens: OUTPUT_TOKENS,
  });
  const usage = result.usage as Partial<LanguageModelUsage> | undefined;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cachedInputTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
  const calls = result.toolCalls.map((call) => {
    const invalid = call as { invalid?: boolean; error?: unknown };
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: invalid.invalid
        ? { __invalid: String(invalid.error ?? "invalid input") }
        : call.input,
    };
  });
  return {
    kind: "turn",
    text: result.text.trim(),
    calls,
    usage: {
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      costUsd: callCost(model, result.providerMetadata, {
        input: inputTokens,
        output: outputTokens,
        cached: cachedInputTokens,
      }),
      ms: Date.now() - started,
    },
  };
}
