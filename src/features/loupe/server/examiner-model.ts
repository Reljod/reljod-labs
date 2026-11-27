import "server-only";
import { generateText, type ModelMessage } from "ai";
import { findingsToReview, trips } from "../domain/evaluate";
import { RUN_LIMITS } from "../domain/limits";
import { standingOf } from "./examination";
import { callOptions, trackCall } from "./llm";
import type { ExaminerModel } from "./ports";
import { examinerInstructions } from "./prompt";
import { TOOLKIT_README } from "./sandbox";
import { examinerTools } from "./tool-schemas";

/** The Examiner on the model gateway: one call, with tools that come back unexecuted. */
export const gatewayExaminer: ExaminerModel = {
  async turn(row, messages) {
    const started = Date.now();
    const result = await generateText({
      ...callOptions(row.model),
      instructions: examinerInstructions({
        rulebook: row.rulebook,
        rulebookVersion: row.rulebook_version,
        kind: row.kind,
        toolkitReadme: TOOLKIT_README,
      }),
      messages,
      tools: examinerTools(),
      maxOutputTokens: RUN_LIMITS.outputTokens,
    });
    const cost = await trackCall({
      examinationId: row.id,
      model: row.model,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      started,
    });
    return {
      text: result.text.trim(),
      toolCalls: result.toolCalls.map((call) => {
        const invalid = call as { invalid?: boolean; error?: unknown };
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: invalid.invalid ? {} : call.input,
        };
      }),
      messages: result.response.messages as ModelMessage[],
      cost,
    };
  },
};

/**
 * The stubbed e2e suite's Examiner: no model. It walks the same tools in a
 * fixed order decided from the Examination's state (look, a Hypothesis on
 * the strongest Sweep Finding, a Check, conclude, the reviews, finish), so
 * the Trail, the gate and the Verdict are real.
 */
export const scriptedExaminer: ExaminerModel = {
  async turn(row) {
    const { state } = row;
    const standing = standingOf(row, state);
    const calls: { toolName: string; input: Record<string, unknown> }[] = [];
    let thought = "";
    const hypothesis = state.hypotheses[0];
    const lead = standing.findings.find((finding) => finding.box) ?? null;
    const unlooked = row.pages
      .map((page) => page.page)
      .filter((page) => !state.looked.includes(page));
    if (state.looked.length === 0) {
      thought = "Looking at the first page before anything else.";
      calls.push(
        { toolName: "look", input: { page: 1 } },
        { toolName: "load_skill", input: { skill: "writing-a-finding" } },
      );
    } else if (!hypothesis && lead && state.counters.checkRuns === 0) {
      thought =
        "One figure looks set differently from its neighbours. Recording that before testing it.";
      calls.push({
        toolName: "hypothesize",
        input: {
          page: lead.page,
          box: lead.box,
          claim:
            "This region looks set differently from the figures around it.",
        },
      });
    } else if (state.counters.checkRuns === 0) {
      const check =
        lead?.check ?? (row.format === "pdf" ? "arithmetic" : "ela");
      thought = `Testing it with the ${check} Check.`;
      calls.push({
        toolName: "run_check",
        input: { check, page: lead?.page ?? 1 },
      });
    } else if (hypothesis?.status === "open") {
      const mine = state.measurements.filter(
        (item) => item.finder === "examiner",
      );
      const tripping = mine.filter(
        (item) => trips(item, row.kind, row.rulebook).tripped,
      );
      const cite = tripping.length ? tripping : mine.slice(0, 1);
      thought = tripping.length
        ? "The Check measured it past the Rule's threshold."
        : "The numbers are ordinary; the Hypothesis does not hold.";
      calls.push({
        toolName: "conclude",
        input: {
          hypothesisId: hypothesis.id,
          outcome: tripping.length ? "supported" : "refuted",
          measurementIds: (cite.length
            ? cite
            : state.measurements.slice(0, 1)
          ).map((item) => item.id),
          explanation: tripping.length
            ? "The Check on this region measured a value past its Rule's threshold."
            : "The Check on this region measured nothing out of the ordinary.",
          confidence: tripping.length ? 0.8 : 0.6,
        },
      });
    } else if (unlooked.length || findingsToReview(standing.findings).length) {
      thought =
        "Covering the remaining pages and reviewing the Sweep's Findings.";
      for (const page of unlooked)
        calls.push({ toolName: "look", input: { page } });
      for (const finding of findingsToReview(standing.findings))
        calls.push({
          toolName: "review_finding",
          input: {
            findingId: finding.id,
            stance: "agree",
            note: "The measured value is past the Rule's threshold at this place.",
          },
        });
    } else if (!state.finished) {
      thought = "Every page was looked at and every Finding reviewed.";
      calls.push({
        toolName: "finish",
        input: {
          summary:
            "Scripted Examination: looked at every page, tested one Hypothesis with a Check and reviewed the Sweep's Findings.",
        },
      });
    }
    const turnNumber = state.counters.turns + 1;
    const toolCalls = calls.map((call, index) => ({
      toolCallId: `stub-${turnNumber}-${index + 1}`,
      ...call,
    }));
    return {
      text: thought,
      toolCalls,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: thought || "Done." },
            ...toolCalls.map((call) => ({
              type: "tool-call" as const,
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: call.input,
            })),
          ],
        },
      ],
      cost: {
        type: "cost",
        model: "stub",
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        ms: 1,
      },
    };
  },
};
