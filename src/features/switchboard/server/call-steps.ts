import type { Owner } from "@/features/access/domain/owner";
import type { Note } from "./ports";

/**
 * The steps of a Call's Workflow. Their names are replay keys: never rename
 * or move them. Each body is one call to the Wrap-up service
 * (`services/wrapup.ts`), which is safe to run twice, since the Workflow SDK
 * retries a step that throws. A step has no request, so it takes the live
 * services; a Call the stubbed suite started is wrapped up by code (its
 * model is the canned one), so it never pays.
 */

async function wrapup() {
  // Imported when the step runs: the container imports the Workflow, which imports these steps.
  const { switchboard } = await import("./container");
  return switchboard().wrapup;
}

export async function cutOff(owner: Owner, callId: string) {
  "use step";
  return (await wrapup()).cutOff(owner, callId);
}

export async function stillLive(owner: Owner, callId: string) {
  "use step";
  return (await wrapup()).stillLive(owner, callId);
}

/** Marks the Wrap-up as running. False when there is nothing to wrap up. */
export async function openWrapup(owner: Owner, callId: string) {
  "use step";
  return (await wrapup()).open(owner, callId);
}

/** The Wrap-up's note: a model reads the transcript, and may run code on it once. */
export async function writeNote(owner: Owner, callId: string): Promise<Note> {
  "use step";
  return (await wrapup()).note(owner, callId);
}

/** The Scorecard, the numbers and the confirmation; the Callback to wait for, if one was promised. */
export async function saveWrapup(owner: Owner, callId: string, note: Note) {
  "use step";
  return (await wrapup()).save(owner, callId, note);
}

export async function failWrapup(owner: Owner, callId: string, error: string) {
  "use step";
  await (await wrapup()).fail(owner, callId, error);
}

/** The Callback's time has come (or someone marked it early). */
export async function callbackDue(
  owner: Owner,
  callId: string,
  ref: string,
  early: boolean,
) {
  "use step";
  await (await wrapup()).callbackDue(owner, callId, ref, early);
}
