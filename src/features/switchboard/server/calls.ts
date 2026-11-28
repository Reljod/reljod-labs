import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, NotFoundError } from "@/platform/errors";
import {
  type CallState,
  NEW_CALL_STATE,
  runBackOfficeTool,
} from "../domain/backoffice";
import type {
  CallEvent,
  CallStatus,
  CallView,
  ReportedEvent,
} from "../domain/contract";
import { detectLanguage } from "../domain/hearing";
import { LIMITS } from "../domain/limits";
import { addUsage, realtimeCost } from "../domain/models";
import { num, ruleOf } from "../domain/rules";
import {
  type Booking,
  disruptionForIssue,
  normalizeReference,
} from "../domain/world";
import { type Db, isUuid, jsonb, sql } from "./db";
import type { NewCall, ReportOutcome, ToolInput, ToolOutcome } from "./ports";
import {
  type CallRow,
  callEvents,
  callRow,
  emit,
  listRecords,
  liveCallRows,
  rulebookOf,
  toCall,
  writeRecords,
} from "./store";

/**
 * A Call's units of work in Postgres, the same for the voice Line, the text
 * Line and an outside MCP client. Each runs under the Call's row lock (the
 * Workspace first when it writes Records), so its state, Records and Events
 * land together. The caps, the Workflow and the model are the service's
 * (`services/calls.ts`); only the pure `runBackOfficeTool` refuses a tool.
 */

const secondsSince = (from: Date) =>
  Math.max(0, Math.round((Date.now() - from.getTime()) / 1000));

/** Ends a live Call inside the transaction that holds its row. */
async function finish(
  tx: Db,
  row: CallRow,
  status: Exclude<CallStatus, "live">,
  by: "caller" | "agent" | "server" | "client",
  reason: string,
) {
  const seconds = secondsSince(row.started_at);
  await tx`
    update switchboard.calls
    set status = ${status}, end_reason = ${reason.slice(0, 200)}, ended_at = now()
    where id = ${row.id} and status = 'live'`;
  if (status === "cut_off")
    await emit(tx, row.owner, row.id, "system", "call.cut_off", {
      reason,
      seconds,
    });
  else
    await emit(tx, row.owner, row.id, "system", "call.ended", {
      by,
      reason,
      seconds,
    });
}

const pastGrace = (row: CallRow) =>
  Date.now() > row.deadline_at.getTime() + LIMITS.cutOffGraceSeconds * 1000;

/**
 * The live Call, locked, or the reason there is none. A Call past its
 * deadline and grace is cut off here, whoever touches it first: the
 * Workflow's timer does the same when nobody does.
 */
async function liveCall(tx: Db, owner: Owner, callId: string) {
  if (!isUuid(callId)) throw new NotFoundError("No such Call.");
  const row = await callRow(owner, callId, tx, true);
  if (!row) throw new NotFoundError("No such Call.");
  if (row.status !== "live") return { row, live: false as const };
  if (pastGrace(row)) {
    await finish(
      tx,
      row,
      "cut_off",
      "server",
      "The Call passed its longest length.",
    );
    return {
      row: { ...row, status: "cut_off" as const },
      live: false as const,
      cut: true,
    };
  }
  return { row, live: true as const };
}

/** Starts a Call: one live Call per Owner, so an older live one is ended first. */
export async function openCall(
  input: NewCall,
): Promise<{ call: CallView; replaced: string[] }> {
  const replaced: string[] = [];
  const row = await sql().begin(async (tx) => {
    await tx`select 1 from switchboard.workspaces where owner = ${input.owner} for update`;
    for (const old of await liveCallRows(input.owner, tx)) {
      await finish(
        tx,
        old,
        pastGrace(old) ? "cut_off" : "ended",
        "server",
        "A new Call started.",
      );
      replaced.push(old.id);
    }
    const rulebook = await rulebookOf(input.owner, tx);
    if (input.scenario.kind === "own") {
      const reference = normalizeReference(input.scenario.bookingRef);
      const records = await listRecords(input.owner, tx);
      const booking = records.find(
        (record) => record.kind === "booking" && record.ref === reference,
      );
      if (!booking)
        throw new InvalidError("No such Booking in the Back office.");
      const disruption = disruptionForIssue(
        input.scenario.issue,
        (booking.data as Booking).serviceId,
      );
      if (disruption)
        await writeRecords(tx, input.owner, null, [
          {
            op: "create",
            kind: "disruption",
            ref: disruption.ref,
            data: disruption.data,
          },
        ]);
      await emit(tx, input.owner, null, "owner", "scenario.set", {
        bookingRef: reference,
        issue: input.scenario.issue,
      });
    }
    const length = ruleOf(rulebook, "call.length");
    const seconds = Math.min(
      LIMITS.callSeconds,
      length.enabled ? num(length, "maxMinutes") * 60 : LIMITS.callSeconds,
    );
    const [created] = await tx<CallRow[]>`
      insert into switchboard.calls
        (owner, line, origin, model, scenario, rulebook, state, consent_audio, deadline_at)
      values (
        ${input.owner}, ${input.line}, ${input.origin}, ${input.model},
        ${jsonb(tx, input.scenario)}, ${jsonb(tx, rulebook)}, ${jsonb(tx, NEW_CALL_STATE)},
        ${input.line === "voice" && input.consentAudio},
        now() + make_interval(secs => ${seconds})
      )
      returning *`;
    await emit(tx, input.owner, created.id, "system", "call.started", {
      line: input.line,
      origin: input.origin,
      model: input.model,
      scenario: input.scenario,
      rules: rulebook.map((rule) => ({
        id: rule.id,
        version: rule.version,
        enabled: rule.enabled,
      })),
      deadlineAt: created.deadline_at.toISOString(),
      consentAudio: created.consent_audio,
    });
    return created;
  });
  return { call: toCall(row), replaced };
}

export async function attachRun(callId: string, runId: string) {
  await sql()`
    update switchboard.calls set workflow_run_id = ${runId}
    where id = ${callId}`;
}

/** A Call that cannot run (no Workflow) is marked failed, never left live. */
export async function failCall(owner: Owner, callId: string, reason: string) {
  await sql().begin(async (tx) => {
    const locked = await callRow(owner, callId, tx, true);
    if (locked?.status === "live")
      await finish(tx, locked, "failed", "server", reason);
  });
}

/** Ends a Call. Ending one that is already over is not an error. */
export async function endCall(
  owner: Owner,
  callId: string,
  by: "caller" | "agent" | "client",
  reason?: string,
): Promise<CallView> {
  const row = await sql().begin(async (tx) => {
    const found = await liveCall(tx, owner, callId);
    if (found.live)
      await finish(
        tx,
        found.row,
        "ended",
        by,
        reason ?? (by === "caller" ? "The Caller hung up." : "The Call ended."),
      );
    return callRow(owner, callId, tx);
  });
  return toCall(row as CallRow);
}

/** What each side has said so far, for the Checks that read the transcript. */
function heardIn(events: CallEvent[], saying: string) {
  const agent: string[] = [];
  const caller: string[] = [];
  for (const event of events) {
    if (event.type === "turn.agent") agent.push(event.data.text);
    else if (event.type === "turn.caller") caller.push(event.data.text);
  }
  if (saying) agent.push(saying);
  return { agent: agent.join("\n"), caller: caller.join("\n") };
}

/**
 * One tool call through the Back office: the only way anything reaches the
 * Records, whichever Line or client asks. It runs under the Call's row lock,
 * so the Call's state, the Records and the two Events land together.
 */
export async function toolCall(input: ToolInput): Promise<ToolOutcome> {
  const started = Date.now();
  return sql().begin(async (tx) => {
    // The Workspace first, then the Call: the one lock order everywhere
    // (`openCall`, `saveWrapup`), so two of them can never deadlock.
    const [workspace] = await tx<{ ref_seq: number }[]>`
      select ref_seq from switchboard.workspaces where owner = ${input.owner} for update`;
    const found = await liveCall(tx, input.owner, input.callId);
    if (!found.live)
      return {
        ok: false,
        output: { error: "The Call is over." },
        summary: "The Call is over.",
        events: [],
        over: found.row.status,
      } satisfies ToolOutcome;
    const row = found.row;
    const records = await listRecords(input.owner, tx);
    const events = await callEvents(input.owner, row.id, tx);
    const heard = heardIn(
      events,
      (input.saying ?? "").slice(0, LIMITS.transcriptChars),
    );
    if (input.hearing)
      heard.caller += `\n${input.hearing.slice(0, LIMITS.transcriptChars)}`;
    const state: CallState = { ...NEW_CALL_STATE, ...row.state };
    const result = runBackOfficeTool(input.name, input.args, {
      rulebook: row.rulebook,
      state,
      records,
      heard,
      refSeq: workspace?.ref_seq ?? 0,
      now: new Date(),
      overDeadline: Date.now() > row.deadline_at.getTime(),
    });
    const callId = input.toolCallId.slice(0, 80);
    const called = await emit(tx, input.owner, row.id, "agent", "tool.called", {
      callId,
      name: input.name.slice(0, 60),
      args: input.args ?? {},
    });
    await writeRecords(tx, input.owner, row.id, result.writes);
    await tx`
      update switchboard.workspaces set ref_seq = ${result.refSeq}
      where owner = ${input.owner}`;
    await tx`
      update switchboard.calls set state = ${jsonb(tx, result.state)}
      where id = ${row.id}`;
    const done = await emit(tx, input.owner, row.id, "system", "tool.result", {
      callId,
      name: input.name.slice(0, 60),
      ok: result.ok,
      ms: Date.now() - started,
      summary: result.summary,
      output: result.output,
      refusal: result.refusal,
      records: result.writes.map((write) => ({
        kind: write.kind,
        ref: write.ref,
        op: write.op,
      })),
    });
    return {
      ok: result.ok,
      output: result.output,
      summary: result.summary,
      events: [called, done],
      over: null,
    } satisfies ToolOutcome;
  });
}

/**
 * What the browser heard and measured in a voice Call: the transcript, the
 * Barge-ins, the wait before each answer, the model's usage. It is the
 * Owner's own account of their own Call (ADR 0029): it feeds the transcript
 * Checks and the Scorecard, and never a Record.
 */
export async function reportEvents(
  owner: Owner,
  callId: string,
  parsed: ReportedEvent[],
): Promise<ReportOutcome> {
  return sql().begin(async (tx) => {
    const found = await liveCall(tx, owner, callId);
    const row = found.row;
    // The last words and the Session log arrive just after the end.
    const late =
      !found.live &&
      row.ended_at !== null &&
      Date.now() - row.ended_at.getTime() < 20_000;
    if (!found.live && !late && !("cut" in found))
      return {
        accepted: 0,
        status: row.status,
        costUsd: Number(row.cost_usd),
        cut: false,
      };
    const [{ count }] = await tx<{ count: number }[]>`
      select count(*)::int as count from switchboard.events
      where owner = ${owner} and call_id = ${row.id}`;
    let room = Math.max(0, LIMITS.eventsPerCall - count);
    let usage = row.usage;
    let cost = Number(row.cost_usd);
    let accepted = 0;
    for (const event of parsed) {
      if (room <= 0) break;
      room--;
      accepted++;
      switch (event.type) {
        case "turn.caller":
          if (!event.text.trim()) break;
          await emit(tx, owner, row.id, "caller", "turn.caller", {
            text: event.text,
            language: detectLanguage(event.text),
            via: event.via,
            atMs: event.atMs,
          });
          break;
        case "turn.agent":
          if (!event.text.trim()) break;
          await emit(tx, owner, row.id, "agent", "turn.agent", {
            text: event.text,
            language: detectLanguage(event.text),
            atMs: event.atMs,
            interrupted: event.interrupted,
            playedMs: event.playedMs,
            latency: event.latency,
          });
          break;
        case "barge_in":
          await emit(tx, owner, row.id, "caller", "barge_in", {
            atMs: event.atMs,
            playedMs: event.playedMs,
          });
          break;
        case "usage": {
          const costUsd = realtimeCost(row.model, event.usage);
          usage = addUsage(usage, event.usage);
          cost += costUsd;
          await emit(tx, owner, row.id, "system", "usage", {
            usage: event.usage,
            costUsd,
          });
          break;
        }
        case "session.opened":
          await emit(tx, owner, row.id, "system", "session.opened", {
            model: row.model,
            mintMs: event.mintMs,
            connectMs: event.connectMs,
          });
          break;
        case "session.error":
          await emit(tx, owner, row.id, "system", "session.error", {
            message: event.message,
          });
          break;
        case "session.log":
          await emit(tx, owner, row.id, "system", "session.log", {
            entries: event.entries,
            audioInSeconds: event.audioInSeconds,
            audioOutSeconds: event.audioOutSeconds,
            dropped: event.dropped,
          });
          break;
      }
    }
    await tx`
      update switchboard.calls
      set usage = ${jsonb(tx, usage)}, cost_usd = ${cost.toFixed(6)}
      where id = ${row.id}`;
    let status = row.status;
    let cut = "cut" in found;
    if (found.live && cost >= LIMITS.usdPerCall) {
      await finish(
        tx,
        row,
        "cut_off",
        "server",
        `The Call reached its spend cap of $${LIMITS.usdPerCall.toFixed(2)}.`,
      );
      status = "cut_off";
      cut = true;
    }
    return { accepted, status, costUsd: cost, cut };
  });
}

/**
 * Appends a Turn an outside MCP client reports, under the Call's row lock and
 * the same per-Call Event cap as the browser's reports.
 */
export async function recordTurn(
  owner: Owner,
  callId: string,
  speaker: "caller" | "agent",
  input: string,
): Promise<"recorded" | "over" | "cut" | "full"> {
  return sql().begin(async (tx) => {
    const found = await liveCall(tx, owner, callId);
    if (!found.live) return "cut" in found ? "cut" : "over";
    const [{ count }] = await tx<{ count: number }[]>`
      select count(*)::int as count from switchboard.events
      where owner = ${owner} and call_id = ${found.row.id}`;
    if (count >= LIMITS.eventsPerCall) return "full";
    const text = input.slice(0, LIMITS.transcriptChars);
    const atMs = Date.now() - found.row.started_at.getTime();
    const language = detectLanguage(text);
    if (speaker === "caller")
      await emit(tx, owner, found.row.id, "caller", "turn.caller", {
        text,
        language,
        via: "mcp",
        atMs,
      });
    else
      await emit(tx, owner, found.row.id, "client", "turn.agent", {
        text,
        language,
        atMs,
        interrupted: false,
      });
    return "recorded";
  });
}

/** Adds a text Turn's model cost to the Call; returns the Call's total. */
export async function addCost(owner: Owner, callId: string, usd: number) {
  const [spent] = await sql()<{ cost_usd: string }[]>`
    update switchboard.calls set cost_usd = cost_usd + ${usd.toFixed(6)}
    where id = ${callId} and owner = ${owner}
    returning cost_usd`;
  return Number(spent?.cost_usd ?? 0);
}

/** Cuts the Call off if it is still live: the Workflow's timer, or the text Line's spend cap. */
export async function cutOffIfLive(
  owner: Owner,
  callId: string,
  reason: string,
) {
  return sql().begin(async (tx) => {
    const row = await callRow(owner, callId, tx, true);
    if (!row || row.status !== "live") return false;
    await finish(tx, row, "cut_off", "server", reason);
    return true;
  });
}
