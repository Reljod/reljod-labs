import "server-only";
import { type CallEvent, type CallView, seconds } from "../domain/contract";

/**
 * A Call as the Sandbox is handed it: small, flat, the shape the Agent's
 * instructions describe.
 */
export function digestOf(call: CallView, events: CallEvent[]) {
  const turns: Record<string, unknown>[] = [];
  const tools: Record<string, unknown>[] = [];
  let bargeIns = 0;
  for (const event of events) {
    if (event.type === "turn.caller")
      turns.push({
        who: "caller",
        text: event.data.text,
        language: event.data.language,
        atMs: event.data.atMs,
      });
    else if (event.type === "turn.agent")
      turns.push({
        who: "agent",
        text: event.data.text,
        language: event.data.language,
        atMs: event.data.atMs,
        ...(event.data.interrupted ? { interrupted: true } : {}),
        ...(event.data.latency
          ? { firstAudioMs: event.data.latency.firstAudioMs }
          : {}),
      });
    else if (event.type === "tool.result")
      tools.push({
        name: event.data.name,
        ok: event.data.ok,
        ms: event.data.ms,
        summary: event.data.summary,
        refusal: event.data.refusal.map((hit) => ({
          ruleId: hit.ruleId,
          version: hit.version,
          title: hit.title,
        })),
      });
    else if (event.type === "barge_in") bargeIns++;
  }
  return {
    id: call.id,
    line: call.line,
    status: call.status,
    model: call.model,
    startedAt: call.startedAt,
    seconds: seconds(call.startedAt, call.endedAt),
    costUsd: call.costUsd,
    scenario: call.scenario,
    turns,
    tools,
    bargeIns,
    scorecard: call.wrapup
      ? {
          passed: call.wrapup.scorecard.passed,
          failed: call.wrapup.scorecard.failed,
          items: call.wrapup.scorecard.items.map((item) => ({
            title: item.title,
            verdict: item.verdict,
          })),
        }
      : null,
  };
}
