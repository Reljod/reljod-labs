import type { ModelMessage } from "ai";
import { examinerFor } from "./container";
import type { EndOutcome, ToolCall } from "./ports";

// Steps: each is durable, so a crash resumes after the last finished one. Their
// names are replay keys (conventions.md): do not rename or move them. Each
// calls the Examiner's service for its Examination (live, or stubbed for one
// the e2e suite started). -------------------------------------------------------------

export async function prepareStep(examinationId: string) {
  "use step";
  return (await examinerFor(examinationId)).prepare(examinationId);
}
prepareStep.maxRetries = 1;

export async function sweepStep(examinationId: string) {
  "use step";
  return (await examinerFor(examinationId)).sweep(examinationId);
}
sweepStep.maxRetries = 1;

export async function openingStep(examinationId: string) {
  "use step";
  return (await examinerFor(examinationId)).opening(examinationId);
}

export async function turnStep(
  examinationId: string,
  messages: ModelMessage[],
) {
  "use step";
  return (await examinerFor(examinationId)).turn(examinationId, messages);
}
// The gateway is sometimes flaky for a provider; a failed turn is retried.
turnStep.maxRetries = 2;

export async function toolStep(examinationId: string, call: ToolCall) {
  "use step";
  return (await examinerFor(examinationId)).callTool(examinationId, call);
}
// A tool reports its own failures; a retry would run code or a Check twice.
toolStep.maxRetries = 0;

export async function noteStep(examinationId: string, text: string) {
  "use step";
  await (await examinerFor(examinationId)).note(examinationId, text);
}

export async function endStep(examinationId: string, outcome: EndOutcome) {
  "use step";
  return (await examinerFor(examinationId)).end(examinationId, outcome);
}
