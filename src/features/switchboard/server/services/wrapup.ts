import "server-only";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import type { CallEvent } from "../../domain/contract";
import { LIMITS } from "../../domain/limits";
import { STUB_MODEL } from "../../domain/models";
import { digestOf } from "../digest";
import type { Note, SwitchboardPorts } from "../ports";

/**
 * What a Call's Workflow does after the Call (ADR 0030): the server-side
 * cut-off, the Wrap-up's note (a model, with one code run in a Sandbox), the
 * Scorecard and the follow-ups (code), and a promised Callback. Each method
 * is one Workflow step, so each is safe to run twice.
 */
export interface WrapupService {
  /** The Workflow's timer: cuts the Call off if it is still live at its deadline. */
  cutOff(owner: Owner, callId: string): Promise<boolean>;
  stillLive(owner: Owner, callId: string): Promise<boolean>;
  open(owner: Owner, callId: string): Promise<boolean>;
  /** The note: a model reads the transcript; code writes a plain one when it cannot, or must not pay again. */
  note(owner: Owner, callId: string): Promise<Note>;
  save(
    owner: Owner,
    callId: string,
    note: Note,
  ): Promise<{ ref: string; minutes: number } | null>;
  fail(owner: Owner, callId: string, error: string): Promise<void>;
  callbackDue(
    owner: Owner,
    callId: string,
    ref: string,
    early: boolean,
  ): Promise<void>;
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

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function createWrapupService(ports: SwitchboardPorts): WrapupService {
  const { store, notes, sandbox } = ports;
  return {
    cutOff: (owner, callId) =>
      store.cutOff(owner, callId, "The Call passed its longest length."),

    async stillLive(owner, callId) {
      return (await store.call(owner, callId))?.status === "live";
    },

    open: (owner, callId) => store.openWrapup(owner, callId),

    async note(owner, callId) {
      const [call, events] = await Promise.all([
        store.call(owner, callId),
        store.events(owner, callId),
      ]);
      if (!call) throw new Error("The Call is gone.");
      const said = events.some((event) => event.type === "turn.caller");
      // A retry after the model was already paid for does not pay again: the
      // code writes the note instead. A Call the stubbed suite started never pays.
      const paid = events.some(
        (event) =>
          event.type === "model.call" && event.data.purpose === "wrapup",
      );
      if (call.model === STUB_MODEL || !said || paid)
        return { ...plainNote(events), model: "code", costUsd: 0 };

      const digest = digestOf(call, events);
      const started = ports.now();
      let analysis: Note["analysis"] = null;
      let runs = 0;
      const runCode = async (code: string) => {
        if (runs >= LIMITS.sandboxRunsPerWrapup)
          return "Already run once; write the note now.";
        runs++;
        await store.emit(owner, callId, "agent", "code.run", {
          purpose: "wrapup",
          code,
        });
        const ran = await sandbox.run({
          owner,
          code,
          files: [{ path: "call.json", content: JSON.stringify(digest) }],
        });
        await store.emit(owner, callId, "system", "code.result", ran);
        if (ran.exitCode === 0 && ran.stdout.trim())
          analysis = { code, output: ran.stdout.trim().slice(0, 2000) };
        return ran.exitCode === 0
          ? ran.stdout || "(no output)"
          : `Failed (exit ${ran.exitCode}): ${ran.stderr.slice(0, 600)}`;
      };
      try {
        const written = await notes.write(digest, runCode);
        await store.emit(owner, callId, "system", "model.call", {
          purpose: "wrapup",
          model: notes.model,
          inputTokens: written.inputTokens,
          outputTokens: written.outputTokens,
          costUsd: written.costUsd,
          ms: ports.now() - started,
        });
        const parsed = noteSchema.safeParse(jsonIn(written.text));
        if (!parsed.success)
          return {
            ...plainNote(events),
            analysis,
            model: "code",
            costUsd: written.costUsd,
          };
        return {
          ...parsed.data,
          analysis,
          model: notes.model,
          costUsd: written.costUsd,
        };
      } catch (error) {
        await store.emit(owner, callId, "system", "wrapup.step", {
          step: "note",
          note: `The model could not write the note (${messageOf(error).slice(0, 160)}); the code wrote a plain one.`,
        });
        return { ...plainNote(events), analysis, model: "code", costUsd: 0 };
      }
    },

    save: (owner, callId, note) => store.saveWrapup(owner, callId, note),
    fail: (owner, callId, error) => store.failWrapup(owner, callId, error),
    callbackDue: (owner, callId, ref, early) =>
      store.callbackDue(owner, callId, ref, early),
  };
}
