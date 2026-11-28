import "server-only";
import { generateText, type ModelMessage } from "ai";
import { container } from "@/platform/services/container";
import { type AnalystPorts, createAnalystWork } from "./analyst";
import { callOptions, trackCall } from "./llm";
import type { AnalystModel, CodeSandbox, ReaderModel } from "./ports";
import { runReader } from "./reader";
import { disposeSandbox, runInSandbox } from "./sandbox";
import { noSandbox, scriptedAnalyst, scriptedReader } from "./stubs";
import { RUN_LIMITS } from "./toolkit/state";
import { analystTools } from "./toolkit/tools";

/** The Analyst on the AI Gateway: one call per turn, its tool calls returned unexecuted. */
const gatewayAnalyst: AnalystModel = {
  async turn({ ctx, instructions, messages }) {
    const started = Date.now();
    const result = await generateText({
      ...callOptions(ctx.models.analyst, "analyst"),
      instructions,
      messages,
      tools: analystTools(),
      maxOutputTokens: RUN_LIMITS.analystOutputTokens,
    });
    const cost = await trackCall({
      runId: ctx.runId,
      purpose: "analyst",
      model: ctx.models.analyst,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      started,
    });
    return {
      text: result.text,
      toolCalls: result.toolCalls.map((call) => {
        const invalid = call as { invalid?: boolean; error?: unknown };
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: invalid.invalid
            ? { __invalid: String(invalid.error ?? "invalid input") }
            : call.input,
        };
      }),
      responseMessages: result.response.messages as ModelMessage[],
      cost,
    };
  },
};

const gatewayReader: ReaderModel = {
  read: ({ ctx, pages, job }) => runReader(ctx, pages, job),
};

/** One Vercel Sandbox per Run, no network. */
export const vercelSandbox: CodeSandbox = {
  run: runInSandbox,
  dispose: disposeSandbox,
};

/**
 * The composition root of a Run's workflow steps (`run-workflow.ts`). Kept
 * apart from `container.ts`, which starts the workflow and so imports it. A
 * Run the stubbed e2e suite started carries `ctx.stub`, and its steps get
 * the scripted Analyst and Readers and no Sandbox.
 */
export const analystWork = container(({ stub }) =>
  createAnalystWork(
    stub
      ? ({
          analyst: scriptedAnalyst,
          reader: scriptedReader,
          sandbox: noSandbox,
        } satisfies AnalystPorts)
      : {
          analyst: gatewayAnalyst,
          reader: gatewayReader,
          sandbox: vercelSandbox,
        },
  ),
);
