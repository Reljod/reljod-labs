import { createGateway, generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import { WRAPUP_INSTRUCTIONS } from "../domain/agent";
import {
  type CallEvent,
  type FollowUp,
  seconds,
  type Wrapup,
} from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { STUB_MODEL, TEXT_MODELS } from "../domain/models";
import { callStats, scoreCall } from "../domain/scorecard";
import { type Callback, formatRef, REF_PREFIX } from "../domain/world";
import { jsonb, sql } from "./db";
import { digestOf } from "./digest";
import { env } from "./env";
import { messageOf } from "./errors";
import { gatewayCost } from "./llm";
import { runCode } from "./sandbox";
import {
  callEvents,
  callRow,
  emit,
  listRecords,
  toCall,
  writeRecords,
} from "./store";

/**
 * The steps of a Call's Workflow. Each is retried by the Workflow SDK when it
 * throws, so each is safe to run twice.
 */

type Note = Pick<
  Wrapup,
  "summary" | "actions" | "promises" | "sentiment" | "analysis"
> & {
  model: string;
  costUsd: number;
};

export async function cutOff(owner: Owner, callId: string) {
  "use step";
  const { cutOffIfLive } = await import("./calls");
  return cutOffIfLive(owner, callId);
}

export async function stillLive(owner: Owner, callId: string) {
  "use step";
  const { isLive } = await import("./calls");
  return isLive(owner, callId);
}

/** Marks the Wrap-up as running. False when there is nothing to wrap up. */
export async function openWrapup(owner: Owner, callId: string) {
  "use step";
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

const noteSchema = z.object({
  summary: z.string().max(1200),
  actions: z
    .array(
      z.object({
        what: z.string().max(300),
        ref: z.string().max(40).nullable(),
      }),
    )
    .max(20),
  promises: z.array(z.string().max(300)).max(10),
  sentiment: z
    .array(
      z.object({
        turn: z.number().int().min(1).max(500),
        score: z.number().min(-2).max(2),
        label: z.string().max(40),
      }),
    )
    .max(200),
});

/** The first JSON object in a model's answer. */
function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** What the code alone can say about a Call, when no model does. */
function plainNote(events: CallEvent[]): Omit<Note, "model" | "costUsd"> {
  const results = events.filter(
    (event): event is Extract<CallEvent, { type: "tool.result" }> =>
      event.type === "tool.result",
  );
  const callers = events.filter((event) => event.type === "turn.caller");
  return {
    summary: callers.length
      ? `The Caller spoke ${callers.length} time${callers.length === 1 ? "" : "s"}; the Back office was asked ${results.length} time${results.length === 1 ? "" : "s"} and refused ${results.filter((result) => result.data.refusal.length > 0).length}.`
      : "The Call ended before the Caller said anything.",
    actions: results
      .filter((result) => result.data.ok && result.data.records.length > 0)
      .map((result) => ({
        what: result.data.summary,
        ref: result.data.records[0]?.ref ?? null,
      })),
    promises: [],
    sentiment: [],
    analysis: null,
  };
}

/** The Wrap-up's note: a model reads the transcript, and may run code on it once. */
export async function writeNote(owner: Owner, callId: string): Promise<Note> {
  "use step";
  const row = await callRow(owner, callId);
  if (!row) throw new Error("The Call is gone.");
  const call = toCall(row);
  const events = await callEvents(owner, callId);
  const said = events.some((event) => event.type === "turn.caller");
  // A retry after the model was already paid for does not pay again: the
  // code writes the note instead.
  const paid = events.some(
    (event) => event.type === "model.call" && event.data.purpose === "wrapup",
  );
  if (call.model === STUB_MODEL || !said || paid)
    return { ...plainNote(events), model: "code", costUsd: 0 };

  const digest = digestOf(call, events);
  const started = Date.now();
  let analysis: Note["analysis"] = null;
  let runs = 0;
  try {
    const result = await generateText({
      model: createGateway({ apiKey: env.aiGatewayApiKey() })(
        TEXT_MODELS.wrapup,
      ),
      instructions: `${WRAPUP_INSTRUCTIONS}

You have one tool, run_code: Node.js in a Sandbox with no network, with this Call in ./call.json (the same object you are given). Use it once, before you write, for anything you would otherwise count by hand: words said by each side, the Agent's longest Turn, the share of tool calls refused. Print a few short lines. If it fails, carry on without it. Your final message is the JSON only.`,
      prompt: JSON.stringify(digest),
      stopWhen: isStepCount(4),
      tools: {
        run_code: tool({
          description:
            "Runs JavaScript (an ES module) in the Sandbox and returns what it printed.",
          inputSchema: z.object({ code: z.string().min(1).max(20_000) }),
          execute: async ({ code }) => {
            if (runs >= 1) return "Already run once; write the note now.";
            runs++;
            await emit(sql(), owner, callId, "agent", "code.run", {
              purpose: "wrapup",
              code,
            });
            const ran = await runCode({
              owner,
              code,
              files: [{ path: "call.json", content: JSON.stringify(digest) }],
            });
            await emit(sql(), owner, callId, "system", "code.result", ran);
            if (ran.exitCode === 0 && ran.stdout.trim())
              analysis = { code, output: ran.stdout.trim().slice(0, 2000) };
            return ran.exitCode === 0
              ? ran.stdout || "(no output)"
              : `Failed (exit ${ran.exitCode}): ${ran.stderr.slice(0, 600)}`;
          },
        }),
      },
    });
    const usage = result.totalUsage;
    const costUsd = gatewayCost(result.providerMetadata) ?? 0;
    await emit(sql(), owner, callId, "system", "model.call", {
      purpose: "wrapup",
      model: TEXT_MODELS.wrapup,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd,
      ms: Date.now() - started,
    });
    const parsed = noteSchema.safeParse(jsonIn(result.text));
    if (!parsed.success)
      return { ...plainNote(events), analysis, model: "code", costUsd };
    return { ...parsed.data, analysis, model: TEXT_MODELS.wrapup, costUsd };
  } catch (error) {
    await emit(sql(), owner, callId, "system", "wrapup.step", {
      step: "note",
      note: `The model could not write the note (${messageOf(error).slice(0, 160)}); the code wrote a plain one.`,
    });
    return { ...plainNote(events), analysis, model: "code", costUsd: 0 };
  }
}

/**
 * The rest of the Wrap-up, all by code: the Scorecard from the Events against
 * the Rulebook the Call ran under, the Call's numbers, the confirmation
 * Record. Returns the Callback to wait for, if one was promised.
 */
export async function saveWrapup(owner: Owner, callId: string, note: Note) {
  "use step";
  return sql().begin(async (tx) => {
    // The Workspace first, then the Call: the same lock order as `callTool`.
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
      set wrapup = ${jsonb(tx, wrapup)}, wrapup_status = 'done'
      where id = ${callId}`;
    await emit(tx, owner, callId, "system", "wrapup.done", {
      costUsd: note.costUsd,
    });
    return callback;
  });
}

export async function failWrapup(owner: Owner, callId: string, error: string) {
  "use step";
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
  "use step";
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
