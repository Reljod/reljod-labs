import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { type FollowUp, seconds, type Wrapup } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { callStats, scoreCall } from "../domain/scorecard";
import { type Callback, formatRef, REF_PREFIX } from "../domain/world";
import { jsonb, sql } from "./db";
import type { Note } from "./ports";
import {
  callEvents,
  callRow,
  emit,
  listRecords,
  toCall,
  writeRecords,
} from "./store";

/**
 * The Wrap-up's units of work, run by the Call's Workflow steps. Each is
 * safe to run twice: the Workflow SDK retries a step that throws.
 */

/** Marks the Wrap-up as running. False when there is nothing to wrap up. */
export async function openWrapup(owner: Owner, callId: string) {
  const row = await callRow(owner, callId);
  if (!row || row.status === "live") return false;
  if (row.wrapup_status === "done") return false;
  await sql()`
    update switchboard.calls set wrapup_status = 'running'
    where id = ${callId} and owner = ${owner}`;
  if (row.wrapup_status === "none")
    await emit(sql(), owner, callId, "system", "wrapup.started", {});
  return true;
}

/**
 * The rest of the Wrap-up, all by code: the Scorecard from the Events against
 * the Rulebook the Call ran under, the Call's numbers, the confirmation
 * Record. Returns the Callback to wait for, if one was promised.
 */
export async function saveWrapup(owner: Owner, callId: string, note: Note) {
  return sql().begin(async (tx) => {
    // The Workspace first, then the Call: the same lock order as `toolCall`.
    await tx`select 1 from switchboard.workspaces where owner = ${owner} for update`;
    const row = await callRow(owner, callId, tx, true);
    if (!row) throw new Error("The Call is gone.");
    if (row.wrapup_status === "done") return null;
    const call = toCall(row);
    const events = await callEvents(owner, callId, tx);
    const scorecard = scoreCall(events, call.rulebook, call.status);
    const stats = callStats(events, seconds(call.startedAt, call.endedAt));
    const changed = events.flatMap((event) =>
      event.type === "tool.result" && event.data.ok ? event.data.records : [],
    );
    const followUps: FollowUp[] = [];

    if (changed.length > 0) {
      const [workspace] = await tx<{ ref_seq: number }[]>`
        update switchboard.workspaces set ref_seq = ref_seq + 1
        where owner = ${owner} returning ref_seq`;
      const ref = formatRef(REF_PREFIX.confirmation, workspace.ref_seq);
      const booking = call.state.verified[0];
      const to = booking
        ? `the contact on booking ${booking}`
        : "the Caller's contact";
      await writeRecords(tx, owner, callId, [
        {
          op: "create",
          kind: "confirmation",
          ref,
          data: {
            to,
            subject: "Your call to Meridia Rail",
            body: [
              note.summary,
              "",
              ...changed.map(
                (item) => `- ${item.kind.replace("_", " ")} ${item.ref}`,
              ),
              "",
              "SPECIMEN. Meridia Rail is fictional; nothing was sent.",
            ]
              .join("\n")
              .slice(0, 2000),
          },
        },
      ]);
      await emit(tx, owner, callId, "system", "confirmation.sent", { ref, to });
      followUps.push({
        kind: "confirmation",
        status: "sent",
        ref,
        detail: `Written to the Back office as ${ref}. Nothing leaves this demo.`,
      });
    } else {
      followUps.push({
        kind: "confirmation",
        status: "none",
        ref: null,
        detail:
          "Nothing changed in the Back office, so there is nothing to confirm.",
      });
    }

    let callback: { ref: string; minutes: number } | null = null;
    const callbackRef = call.state.callbackRef;
    const records = callbackRef ? await listRecords(owner, tx) : [];
    const record = records.find(
      (item) => item.kind === "callback" && item.ref === callbackRef,
    );
    if (callbackRef && record) {
      const data = record.data as Callback;
      const minutes = Math.min(
        LIMITS.callbackMaxMinutes,
        Math.max(1, data.inMinutes),
      );
      const dueAt = new Date(
        Date.parse(call.endedAt ?? new Date().toISOString()) + minutes * 60_000,
      ).toISOString();
      await writeRecords(tx, owner, callId, [
        {
          op: "update",
          kind: "callback",
          ref: callbackRef,
          data: { ...data, dueAt },
        },
      ]);
      await emit(tx, owner, callId, "system", "callback.waiting", {
        ref: callbackRef,
        dueAt,
      });
      followUps.push({
        kind: "callback",
        status: "waiting",
        ref: callbackRef,
        dueAt,
        detail: `The Workflow is asleep until ${minutes} minutes after the Call.`,
      });
      callback = { ref: callbackRef, minutes };
    } else {
      followUps.push({
        kind: "callback",
        status: "none",
        ref: null,
        dueAt: null,
        detail: "No callback was promised.",
      });
    }

    const wrapup: Wrapup = {
      summary: note.summary,
      actions: note.actions,
      promises: note.promises,
      sentiment: note.sentiment,
      scorecard,
      stats,
      followUps,
      analysis: note.analysis,
      model: note.model,
      costUsd: note.costUsd,
    };
    await tx`
      update switchboard.calls
      set wrapup = ${jsonb(tx, wrapup)}, wrapup_status = 'done',
        cost_usd = cost_usd + ${note.costUsd.toFixed(6)}
      where id = ${callId}`;
    await emit(tx, owner, callId, "system", "wrapup.done", {
      costUsd: note.costUsd,
    });
    return callback;
  });
}

export async function failWrapup(owner: Owner, callId: string, error: string) {
  await sql()`
    update switchboard.calls set wrapup_status = 'failed'
    where id = ${callId} and owner = ${owner} and wrapup_status <> 'done'`;
  await emit(sql(), owner, callId, "system", "wrapup.failed", {
    error: error.slice(0, 300),
  });
}

/** The Callback's time has come (or someone marked it early). */
export async function callbackDue(
  owner: Owner,
  callId: string,
  ref: string,
  early: boolean,
) {
  await sql().begin(async (tx) => {
    const row = await callRow(owner, callId, tx, true);
    if (!row?.wrapup) return;
    const records = await listRecords(owner, tx);
    const record = records.find(
      (item) => item.kind === "callback" && item.ref === ref,
    );
    if (!record || (record.data as Callback).status !== "scheduled") return;
    await writeRecords(tx, owner, callId, [
      {
        op: "update",
        kind: "callback",
        ref,
        data: { ...(record.data as Callback), status: "due" },
      },
    ]);
    const wrapup: Wrapup = {
      ...row.wrapup,
      followUps: row.wrapup.followUps.map((item) =>
        item.kind === "callback"
          ? {
              ...item,
              status: "due",
              detail: early
                ? "Marked due early from the page; the Workflow woke up."
                : "The Workflow woke up on time. A person would ring now.",
            }
          : item,
      ),
    };
    await tx`update switchboard.calls set wrapup = ${jsonb(tx, wrapup)} where id = ${callId}`;
    await emit(tx, owner, callId, "system", "callback.due", { ref, early });
  });
}
