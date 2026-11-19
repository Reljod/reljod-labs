import type { ToolResultPart } from "ai";
import { RUN_LIMITS } from "../domain/limits";
import type { EndOutcome } from "./ending";
import { imageMark } from "./marks";
import {
  endStep,
  noteStep,
  openingStep,
  prepareStep,
  sweepStep,
  toolStep,
  turnStep,
} from "./steps";

export type ExaminationInput = { examinationId: string };

/*
 * Only pure code runs in the workflow body; everything that touches the
 * database, the Sandbox or a model is a step in ./steps.
 */

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// At the start, or after a workflow's own "Step … failed after 1 retry: ".
const SHOWN_ERROR =
  /(?:^|: )((?:Sandbox unavailable|The Document could not be opened|The Sweep failed|The Upload|The Sample|No such Sample|No recorded Sweep)[\s\S]*)/;

/** What a person may be told about a failure: the Toolkit's and the Sandbox's own refusals, nothing else. */
export function shown(error: unknown) {
  const match = SHOWN_ERROR.exec(message(error));
  return match
    ? match[1].trim().slice(0, 300)
    : "The Examination failed on our side.";
}

/**
 * One Examination of one Document. The Document is prepared and swept
 * without a model. Then, when Loupe's own Examiner drives, each Examiner
 * turn is a step that calls the model once with tools that do not execute,
 * and each tool call it returns is a step of its own, run through the MCP
 * server. The loop ends when `finish` passes the Done gate, at the turn or
 * spend cap (checked before every turn and every tool call), or when the
 * Examination's row is over (stopped by its Owner, or failed elsewhere).
 */
export async function loupeExamination(input: ExaminationInput) {
  "use workflow";
  const { examinationId } = input;
  try {
    const prepared = await prepareStep(examinationId);
    if (prepared.kind === "over") return { examinationId, status: "over" };
    await sweepStep(examinationId);
    if (prepared.driver === "sweep") {
      const ended = await endStep(examinationId, { status: "completed" });
      return { examinationId, status: ended.status };
    }
    // A client drives the Examiner's tools itself; its `finish` ends the Examination.
    if (prepared.driver === "client")
      return { examinationId, status: "running" };

    let messages = await openingStep(examinationId);
    let outcome: EndOutcome | null = null;
    let turns = 0;
    let costUsd = 0;
    let idle = 0;

    while (!outcome) {
      if (turns >= RUN_LIMITS.turns) {
        outcome = {
          status: "completed",
          stoppedBy: "turns",
          note: `Stopped at the cap of ${RUN_LIMITS.turns} Examiner turns before the Done gate passed; the Findings are what was measured so far.`,
        };
        break;
      }
      if (costUsd >= RUN_LIMITS.costUsd) {
        outcome = {
          status: "completed",
          stoppedBy: "cost",
          note: `Stopped at the spend cap of $${RUN_LIMITS.costUsd.toFixed(2)} before the Done gate passed; the Findings are what was measured so far.`,
        };
        break;
      }
      const result = await turnStep(examinationId, messages);
      if (result.kind === "over") {
        // The row is already over, so end() writes nothing; it still stops the Sandbox.
        const ended = await endStep(examinationId, {
          status: "failed",
          error: "The Examination ended outside the workflow.",
        });
        return { examinationId, status: ended.status };
      }
      messages = result.messages;
      turns = result.turns;
      costUsd = result.costUsd;

      if (result.toolCalls.length === 0) {
        idle++;
        if (idle >= 3) {
          outcome = {
            status: "completed",
            stoppedBy: "idle",
            note: "The Examiner stopped calling tools before the Done gate passed.",
          };
          break;
        }
        await noteStep(
          examinationId,
          "The Examiner answered without a tool call; reminded it to work through the tools.",
        );
        messages = [
          ...messages,
          {
            role: "user",
            content:
              "Keep working through the tools. When the Done gate passes, call finish with a summary.",
          },
        ];
        continue;
      }
      idle = 0;

      const results: ToolResultPart[] = [];
      const images: string[] = [];
      for (const call of result.toolCalls) {
        if (outcome) {
          results.push({
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: {
              type: "text",
              value: "Not run: the Examination finished.",
            },
          });
          continue;
        }
        const done = await toolStep(examinationId, call);
        results.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: "text", value: done.output },
        });
        if (done.imageKey) images.push(done.imageKey);
        if (done.finished) outcome = { status: "completed" };
      }
      messages = [
        ...messages,
        { role: "tool", content: results },
        // What it looked at follows as images; only their keys are kept here.
        ...(images.length
          ? [
              {
                role: "user" as const,
                content: images.map((key) => ({
                  type: "text" as const,
                  text: imageMark(key),
                })),
              },
            ]
          : []),
      ];
    }

    const ended = await endStep(examinationId, outcome);
    return { examinationId, status: ended.status };
  } catch (error) {
    const ended = await endStep(examinationId, {
      status: "failed",
      error: shown(error),
    });
    return { examinationId, status: ended.status };
  }
}
