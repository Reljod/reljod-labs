import "server-only";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import { supervisorInstructions } from "../domain/agent";
import type { SupervisorStreamPart } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { TEXT_MODELS } from "../domain/models";
import { loadCall } from "./calls";
import { sql } from "./db";
import { digestOf, digests, rulesFile } from "./digest";
import { InvalidError, messageOf } from "./errors";
import { gateway, gatewayCost } from "./llm";
import { takeRate, type Visitor } from "./rate";
import { runCode } from "./sandbox";
import { emit, listCalls, rulebookOf } from "./store";

/**
 * Supervisor mode: the same Agent, asked about past Calls by the line's
 * Owner. Numbers come from code it writes and runs in the Sandbox over the
 * last Calls; it can read, and it can count, and it can change nothing.
 */
export async function* askSupervisor(input: {
  owner: Owner;
  who: Visitor;
  question: string;
  signal?: AbortSignal;
}): AsyncGenerator<SupervisorStreamPart> {
  const question = input.question.trim().slice(0, LIMITS.turnChars);
  if (!question) throw new InvalidError("Ask something first.");
  await takeRate(input.who, input.owner, "supervisor");
  const rulebook = await rulebookOf(input.owner);
  await emit(sql(), input.owner, null, "owner", "supervisor.asked", { question });

  const queue: SupervisorStreamPart[] = [];
  let runs = 0;
  let steps = 0;
  let text = "";
  const started = Date.now();
  let files: { path: string; content: string }[] | null = null;
  const sandboxFiles = async () =>
    (files ??= [
      { path: "calls.json", content: JSON.stringify(await digests(input.owner)) },
      { path: "rules.json", content: JSON.stringify(rulesFile(rulebook)) },
    ]);

  try {
    const result = streamText({
      model: gateway()(TEXT_MODELS.supervisor),
      instructions: supervisorInstructions(rulebook),
      prompt: question,
      stopWhen: isStepCount(LIMITS.supervisorSteps),
      abortSignal: input.signal,
      tools: {
        list_calls: tool({
          description:
            "The Owner's past Calls, newest first: id, line, status, when, cost, the Wrap-up's headline and score.",
          inputSchema: z.object({}),
          execute: async () => {
            queue.push({ kind: "tool", name: "list_calls", note: "Listing past Calls" });
            return (await listCalls(input.owner, LIMITS.supervisorCalls)).map((call) => ({
              id: call.id,
              line: call.line,
              status: call.status,
              startedAt: call.startedAt,
              costUsd: call.costUsd,
              headline: call.headline,
              refusals: call.refusals,
              score: call.score,
            }));
          },
        }),
        get_call: tool({
          description: "One Call in full: its Turns, tool calls and Scorecard.",
          inputSchema: z.object({ callId: z.string().uuid() }),
          execute: async ({ callId }) => {
            queue.push({ kind: "tool", name: "get_call", note: "Reading one Call" });
            try {
              const { call, events } = await loadCall(input.owner, callId);
              return digestOf(call, events);
            } catch {
              return { error: "No such Call." };
            }
          },
        }),
        run_code: tool({
          description:
            "Runs JavaScript (an ES module, Node.js) in the Sandbox, with calls.json and rules.json in the working directory and no network. Returns what it printed.",
          inputSchema: z.object({ code: z.string().min(1).max(20_000) }),
          execute: async ({ code }) => {
            if (runs >= LIMITS.sandboxRunsPerAnswer)
              return `That is ${LIMITS.sandboxRunsPerAnswer} runs for this answer. Answer with what you have.`;
            runs++;
            try {
              await takeRate(input.who, input.owner, "sandbox");
            } catch (error) {
              return messageOf(error);
            }
            queue.push({ kind: "code", code });
            await emit(sql(), input.owner, null, "supervisor", "code.run", {
              purpose: "supervisor",
              code,
            });
            const ran = await runCode({
              owner: input.owner,
              code,
              files: await sandboxFiles(),
            });
            await emit(sql(), input.owner, null, "system", "code.result", ran);
            queue.push({
              kind: "code_result",
              exitCode: ran.exitCode,
              stdout: ran.stdout,
              stderr: ran.stderr,
            });
            return ran.exitCode === 0
              ? ran.stdout || "(no output)"
              : `Failed (exit ${ran.exitCode}): ${ran.stderr.slice(0, 1200)}`;
          },
        }),
      },
    });
    for await (const part of result.fullStream) {
      yield* queue.splice(0);
      if (part.type === "text-delta") {
        text += part.text;
        yield { kind: "delta", text: part.text };
      } else if (part.type === "finish-step") steps++;
      else if (part.type === "error")
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
    yield* queue.splice(0);
    const usage = await result.totalUsage;
    const costUsd = gatewayCost(await result.providerMetadata) ?? 0;
    await emit(sql(), input.owner, null, "system", "model.call", {
      purpose: "supervisor",
      model: TEXT_MODELS.supervisor,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd,
      ms: Date.now() - started,
    });
    await emit(sql(), input.owner, null, "supervisor", "supervisor.answered", {
      text: text.slice(0, 4000),
      steps,
      costUsd,
    });
    yield { kind: "done", costUsd, steps };
  } catch (error) {
    yield* queue.splice(0);
    console.error("[switchboard] supervisor failed", messageOf(error));
    yield { kind: "error", message: "The Agent could not answer. Try that again." };
  }
}
