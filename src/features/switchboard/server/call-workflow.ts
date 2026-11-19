import { createHook, sleep } from "workflow";
import type { Owner } from "@/features/access/domain/owner";
import {
  callbackDue,
  cutOff,
  failWrapup,
  openWrapup,
  saveWrapup,
  writeNote,
} from "./call-steps";

/**
 * One durable Workflow per Call (ADR 0030). It is the server's clock on the
 * Call and everything that happens after it:
 *
 * 1. wait for the Call to end (a hook the end resumes), or for its deadline
 *    plus a grace, whichever is first; at the deadline it cuts the Call off,
 *    whatever the browser is doing;
 * 2. the Wrap-up: the note (a model), the Scorecard (code), the follow-ups;
 * 3. a promised Callback waits as a durable sleep, or until someone marks it
 *    done early.
 *
 * Only waits and plain values live in the body; every database or model
 * touch is a step.
 */

export const callHookToken = (callId: string) => `switchboard:call:${callId}`;
export const callbackHookToken = (callId: string) =>
  `switchboard:callback:${callId}`;

export type LifecycleInput = { callId: string; owner: Owner; deadlineAt: string };

export async function callLifecycle(input: LifecycleInput) {
  "use workflow";
  const ended = createHook<{ ended: true }>({ token: callHookToken(input.callId) });
  await ended.getConflict();
  const waitMs = Math.max(1_000, Date.parse(input.deadlineAt) - Date.now() + 20_000);
  const byHook = await Promise.race([
    ended.then(() => true),
    sleep(`${Math.ceil(waitMs / 1000)}s`).then(() => false),
  ]);
  if (!byHook) await cutOff(input.owner, input.callId);
  // The browser's last words (the final Turn, the Session log) land just after the end.
  await sleep("3s");

  let callback: { ref: string; minutes: number } | null = null;
  try {
    const opened = await openWrapup(input.owner, input.callId);
    if (!opened) return { wrapup: "skipped" };
    const note = await writeNote(input.owner, input.callId);
    callback = await saveWrapup(input.owner, input.callId, note);
  } catch (error) {
    await failWrapup(
      input.owner,
      input.callId,
      error instanceof Error ? error.message : String(error),
    );
    return { wrapup: "failed" };
  }

  if (callback) {
    const early = createHook<{ done: true }>({
      token: callbackHookToken(input.callId),
    });
    await early.getConflict();
    const wasEarly = await Promise.race([
      early.then(() => true),
      sleep(`${callback.minutes * 60}s`).then(() => false),
    ]);
    await callbackDue(input.owner, input.callId, callback.ref, wasEarly);
  }
  return { wrapup: "done" };
}
