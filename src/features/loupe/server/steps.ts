import type { ModelMessage } from "ai";
import type { EndOutcome } from "./ending";
import {
  callTool,
  end,
  note,
  opening,
  prepare,
  sweep,
  type ToolCall,
  turn,
} from "./examiner";

// Steps: each is durable, so a crash resumes after the last finished one. Their
// names are replay keys (conventions.md): do not rename or move them. -----------------

export async function prepareStep(examinationId: string) {
  "use step";
  return prepare(examinationId);
}
prepareStep.maxRetries = 1;

export async function sweepStep(examinationId: string) {
  "use step";
  return sweep(examinationId);
}
sweepStep.maxRetries = 1;

export async function openingStep(examinationId: string) {
  "use step";
  return opening(examinationId);
}

export async function turnStep(
  examinationId: string,
  messages: ModelMessage[],
) {
  "use step";
  return turn(examinationId, messages);
}
// The gateway is sometimes flaky for a provider; a failed turn is retried.
turnStep.maxRetries = 2;

export async function toolStep(examinationId: string, call: ToolCall) {
  "use step";
  return callTool(examinationId, call);
}
// A tool reports its own failures; a retry would run code or a Check twice.
toolStep.maxRetries = 0;

export async function noteStep(examinationId: string, text: string) {
  "use step";
  await note(examinationId, text);
}

export async function endStep(examinationId: string, outcome: EndOutcome) {
  "use step";
  return end(examinationId, outcome);
}
