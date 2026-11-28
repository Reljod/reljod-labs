import "server-only";
import { resumeHook, start } from "workflow/api";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import { container } from "@/platform/services/container";
import { callInstructions } from "../domain/agent";
import { realtimeModel } from "../domain/models";
import {
  callbackHookToken,
  callHookToken,
  callLifecycle,
} from "./call-workflow";
import {
  addCost,
  attachRun,
  cutOffIfLive,
  endCall,
  failCall,
  openCall,
  recordTurn,
  reportEvents,
  toolCall,
} from "./calls";
import { switchboardRate } from "./caps";
import { sql } from "./db";
import { env } from "./env";
import { cannedAgent, modelAgent } from "./line";
import { cannedNoteWriter, modelNoteWriter } from "./note-writer";
import type {
  CallLifecycles,
  CodeRunner,
  RealtimeSessions,
  SwitchboardStore,
} from "./ports";
import { addRuleVersion } from "./rules";
import { runCode } from "./sandbox";
import { createSwitchboardServices } from "./services";
import { grantSession, SAMPLE_RATE, sessionTools } from "./session";
import {
  bookingExists,
  callEvents,
  callRow,
  emit,
  ensureWorkspace,
  listCalls,
  listRecords,
  liveCallId,
  resetRecords,
  ruleRows,
  toCall,
  trail,
} from "./store";
import {
  callbackDue,
  failWrapup,
  openWrapup,
  saveWrapup,
} from "./wrapup-store";

/** Switchboard's Postgres, as the services' store. */
const store: SwitchboardStore = {
  ensureWorkspace,
  resetRecords,
  records: (owner) => listRecords(owner),
  bookingExists,
  trail: (owner, before) => trail(owner, { before }),
  ruleRows: (owner) => ruleRows(owner),
  addRuleVersion,
  emit: (owner, callId, actor, type, data) =>
    emit(sql(), owner, callId, actor, type, data),
  calls: (owner) => listCalls(owner),
  async call(owner, callId) {
    const row = await callRow(owner, callId);
    return row ? toCall(row) : null;
  },
  events: (owner, callId, afterId = 0) =>
    callEvents(owner, callId, sql(), afterId),
  liveCallId,
  open: openCall,
  attachRun,
  fail: failCall,
  end: endCall,
  tool: toolCall,
  report: reportEvents,
  recordTurn,
  addCost,
  cutOff: cutOffIfLive,
  openWrapup,
  saveWrapup,
  failWrapup,
  callbackDue,
};

/** One durable Workflow per Call (ADR 0030), woken by hooks. */
const lifecycles: CallLifecycles = {
  async start(input) {
    return (await start(callLifecycle, [input])).runId;
  },
  async wake(callId) {
    try {
      await resumeHook(callHookToken(callId), { ended: true });
    } catch {
      // The Workflow is already past its wait (it cut the Call off itself).
    }
  },
  async callbackNow(callId) {
    try {
      await resumeHook(callbackHookToken(callId), { done: true });
      return true;
    } catch {
      return false;
    }
  },
};

/** The voice Line's realtime Session: a one-minute client secret from AI Gateway. */
const gatewaySessions: RealtimeSessions = { grant: grantSession };

/**
 * The stubbed suite's Session grant: the setup the server would write, and a
 * secret that opens nothing, so no realtime model is reached or paid.
 */
const cannedSessions: RealtimeSessions = {
  async grant(call) {
    return {
      token: "stub",
      url: "",
      model: call.model,
      mintMs: 0,
      config: {
        instructions: callInstructions(call.rulebook, true),
        voice: realtimeModel(call.model)?.voice,
        tools: sessionTools(),
        sampleRate: SAMPLE_RATE,
      },
    };
  },
};

const vercelSandbox: CodeRunner = { run: runCode };

/** The stubbed suite's Sandbox: a canned run, nothing started. */
const cannedSandbox: CodeRunner = {
  async run() {
    return {
      stdout: "stub run: no Sandbox in the stubbed e2e suite\n",
      stderr: "",
      exitCode: 0,
      ms: 1,
    };
  },
};

/**
 * Switchboard's composition root. Live: the model gateway (the text Line's
 * Agent, the Wrap-up's note, the voice Session's secret) and Vercel Sandbox.
 * Stubbed (e2e without `x-e2e-live: 1`, and MCP calls on a token the stubbed
 * suite minted): the canned Agent of `domain/stub.ts`, a canned note, a
 * Session grant that opens nothing and a canned Sandbox. Gates, caps, the
 * Back office and its Rules, the database and the Workflow are real in both.
 */
export const switchboard = container(({ stub }) =>
  createSwitchboardServices({
    store,
    rate: switchboardRate,
    agent: stub ? cannedAgent : modelAgent,
    sessions: stub ? cannedSessions : gatewaySessions,
    notes: stub ? cannedNoteWriter : modelNoteWriter,
    sandbox: stub ? cannedSandbox : vercelSandbox,
    lifecycles,
    access: {
      secret: env.rateLimitSalt,
      hostEmails: accessEnv.hostEmails,
      e2e: () => Boolean(env.e2eBypassToken()),
      guestPass: guestPassOf,
    },
    sandboxConfigured: env.sandboxConfigured,
    stub,
    now: Date.now,
  }),
);
