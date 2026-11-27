import "server-only";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { WRAPUP_INSTRUCTIONS } from "../domain/agent";
import { STUB_MODEL, TEXT_MODELS } from "../domain/models";
import { gateway, gatewayCost } from "./llm";
import type { NoteWriter } from "./ports";

/** The Wrap-up's model: it reads the Call's digest and may run code on it once. */
export const modelNoteWriter: NoteWriter = {
  model: TEXT_MODELS.wrapup,
  async write(digest, runCode) {
    const result = await generateText({
      model: gateway()(TEXT_MODELS.wrapup),
      instructions: `${WRAPUP_INSTRUCTIONS}

You have one tool, run_code: Node.js in a Sandbox with no network, with this Call in ./call.json (the same object you are given). Use it once, before you write, for anything you would otherwise count by hand: words said by each side, the Agent's longest Turn, the share of tool calls refused. Print a few short lines. If it fails, carry on without it. Your final message is the JSON only.`,
      prompt: JSON.stringify(digest),
      stopWhen: isStepCount(4),
      tools: {
        run_code: tool({
          description:
            "Runs JavaScript (an ES module) in the Sandbox and returns what it printed.",
          inputSchema: z.object({ code: z.string().min(1).max(20_000) }),
          execute: ({ code }) => runCode(code),
        }),
      },
    });
    return {
      text: result.text,
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      costUsd: gatewayCost(result.providerMetadata) ?? 0,
    };
  },
};

/**
 * The stubbed suite's note: a fixed JSON answer, no model. (A Call the
 * stubbed suite starts is answered by the canned Agent, and its Wrap-up is
 * written by code before any model is asked.)
 */
export const cannedNoteWriter: NoteWriter = {
  model: STUB_MODEL,
  async write() {
    return {
      text: JSON.stringify({
        summary: "Stub note: the canned Agent took the Call.",
        actions: [],
        promises: [],
        sentiment: [],
      }),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  },
};
