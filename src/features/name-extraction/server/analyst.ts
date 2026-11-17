import "server-only";
import { generateText, type ModelMessage } from "ai";
import {
  CODE_PENDING,
  type DocumentText,
  type DoneGate,
  type ExtractedName,
  type RunEventInput,
  type RunStatus,
  type Score,
  type StopReason,
  type ToolId,
} from "../domain/contract";
import { answerKeyFor, CORPUS, generateDocument } from "../domain/corpus";
import { applyRulebook, mergeNames } from "../domain/resolve";
import { scoreNames } from "../domain/score";
import { sweep } from "../domain/sweep";
import { SKILLS } from "../skills";
import { loadDocument } from "./document";
import { emit, emitStrict, runSink } from "./emit";
import { callOptions, trackCall } from "./llm";
import { type ReaderJob, type ReaderResult, runReader } from "./reader";
import { disposeSandbox, runInSandbox } from "./sandbox";
import { grepPages, grepText } from "./toolkit/grep";
import { compactHistory } from "./toolkit/history";
import { outlineText, readPages } from "./toolkit/pages";
import {
  analystBrief,
  analystInstructions,
  asDocumentText,
  readerOverheadTokens,
} from "./toolkit/prompt";
import { applyRecord, forEvent } from "./toolkit/register";
import { stateFiles } from "./toolkit/sandbox-files";
import {
  type AnalystState,
  cap,
  doneGate,
  gateRefusal,
  initialState,
  markRead,
  numbered,
  planReaderRanges,
  RUN_LIMITS,
  type RunContext,
  rangesText,
  readerModelRefusal,
  type SweepCandidate,
  unreadRanges,
} from "./toolkit/state";
import {
  analystTools,
  isToolId,
  summarise,
  TOOL_SCHEMAS,
} from "./toolkit/tools";

/** The Analyst's ledger: its state without the conversation, which only turns need. */
export type Ledger = Omit<AnalystState, "messages">;

export type ToolCall = { toolCallId: string; toolName: string; input: unknown };

// The Document and its Sweep, once per function instance ---------------------------------

const prepared = new Map<
  string,
  Promise<{ document: DocumentText; candidates: SweepCandidate[] }>
>();

/** The Document and its numbered Sweep Candidates, computed once per Run per instance. */
export function prepare(ctx: RunContext) {
  let hit = prepared.get(ctx.runId);
  if (!hit) {
    hit = loadDocument(ctx.source).then((document) => ({
      document,
      candidates: numbered(sweep(document, ctx.rulebook)),
    }));
    hit.catch(() => prepared.delete(ctx.runId));
    prepared.set(ctx.runId, hit);
    while (prepared.size > 4) {
      const oldest = prepared.keys().next().value;
      if (oldest === undefined || oldest === ctx.runId) break;
      prepared.delete(oldest);
    }
  }
  return hit;
}

function gateOf(
  document: DocumentText,
  candidates: SweepCandidate[],
  ledger: Ledger,
): DoneGate {
  return doneGate(document.pages.length, candidates, ledger);
}

/** One line of the gate, appended to every tool result so the Analyst knows where it stands. */
function gateLine(gate: DoneGate, ledger: Ledger) {
  const turnsLeft = RUN_LIMITS.analystTurns - ledger.turns;
  return `[gate: pages read ${gate.pagesRead}/${gate.pagesTotal}, open Candidates ${gate.candidatesOpen}, ${gate.passed ? "PASSED, you may finish" : "not passed"} · Register ${ledger.register.length} Names · turns left ${turnsLeft} · Readers left ${RUN_LIMITS.readers - ledger.readers.length} · spent $${ledger.costUsd.toFixed(3)}]`;
}

/** A Run whose row says it is over (or is gone) must not spend another cent. */
function isOver(status: RunStatus | null) {
  return status !== "queued" && status !== "running";
}

// Begin ------------------------------------------------------------------------------------

export async function begin(ctx: RunContext): Promise<AnalystState> {
  const { document, candidates } = await prepare(ctx);
  await runSink().update(ctx.runId, { status: "running" });
  const state = initialState();
  state.messages = [
    {
      role: "user",
      content: analystBrief({
        title: document.title,
        pages: document.pages.length,
      }),
    },
  ];
  await emit(
    ctx.runId,
    {
      type: "start",
      document: {
        id: document.id,
        title: document.title,
        pages: document.pages.length,
      },
      source: ctx.source,
      models: ctx.models,
      rulebookVersion: ctx.rulebookVersion,
    },
    {
      type: "log",
      level: "info",
      text: `Sweep: ${candidates.length} Candidates over ${document.pages.length} pages · Rulebook v${ctx.rulebookVersion} · Analyst ${ctx.models.analyst}, Readers ${ctx.models.reader}`,
    },
    { type: "gate", gate: gateOf(document, candidates, state) },
  );
  return state;
}

// One Analyst turn -----------------------------------------------------------------------

export type TurnResult =
  | { kind: "over"; status: RunStatus | null }
  | {
      kind: "turn";
      messages: ModelMessage[];
      toolCalls: ToolCall[];
      costUsd: number;
    };

/** One Analyst model call, with tools that come back unexecuted. */
export async function analystTurn(
  ctx: RunContext,
  messages: ModelMessage[],
): Promise<TurnResult> {
  // Stopped by its Owner, or failed or ended elsewhere: either way, stop paying.
  const status = await runSink().status(ctx.runId);
  if (isOver(status)) return { kind: "over", status };
  const history = compactHistory(messages);
  const started = Date.now();
  const result = await generateText({
    ...callOptions(ctx.models.analyst, "analyst"),
    instructions: analystInstructions(ctx.rulebook, ctx.rulebookVersion),
    messages: history,
    tools: analystTools(),
    maxOutputTokens: RUN_LIMITS.analystOutputTokens,
  });
  const cost = await trackCall({
    runId: ctx.runId,
    purpose: "analyst",
    model: ctx.models.analyst,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
    started,
  });
  const events: RunEventInput[] = [];
  if (result.text.trim())
    events.push({ type: "thought", text: result.text.trim() });
  events.push(cost);
  await emit(ctx.runId, ...events);
  const toolCalls = result.toolCalls.map((call) => {
    const invalid = call as { invalid?: boolean; error?: unknown };
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: invalid.invalid
        ? { __invalid: String(invalid.error ?? "invalid input") }
        : call.input,
    };
  });
  return {
    kind: "turn",
    messages: [...history, ...(result.response.messages as ModelMessage[])],
    toolCalls,
    costUsd: cost.costUsd,
  };
}

// Tools ------------------------------------------------------------------------------------

export type ToolOutcome = {
  ledger: Ledger;
  output: string;
  /** `finish` passed the gate: the Run ends after this call. */
  finished?: { summary: string };
};

function parseInput<T extends ToolId>(toolId: T, input: unknown) {
  if (input && typeof input === "object" && "__invalid" in input) {
    return {
      ok: false as const,
      error: String((input as { __invalid: unknown }).__invalid),
    };
  }
  const parsed = TOOL_SCHEMAS[toolId].safeParse(input);
  return parsed.success
    ? { ok: true as const, value: parsed.data }
    : {
        ok: false as const,
        error: parsed.error.issues
          .slice(0, 5)
          .map(
            (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
          )
          .join("; "),
      };
}

/**
 * Runs one tool call (every tool but spawn_readers, which fans out in the
 * workflow). Emits the tool's start and done events around it, and the
 * events of what it changed.
 */
export async function runTool(
  ctx: RunContext,
  ledger: Ledger,
  call: ToolCall,
): Promise<ToolOutcome> {
  const { document, candidates } = await prepare(ctx);
  const started = Date.now();
  if (!isToolId(call.toolName)) {
    return { ledger, output: `Unknown tool "${call.toolName}".` };
  }
  const toolId = call.toolName;
  const startEvent = {
    type: "tool" as const,
    callId: call.toolCallId,
    tool: toolId,
    summary: summarise(toolId, call.input),
    input: call.input,
    state: "start" as const,
  };
  const parsed = parseInput(toolId, call.input);
  if (!parsed.ok) {
    const output = `${toolId} refused: ${parsed.error}`;
    await emit(ctx.runId, startEvent, {
      ...startEvent,
      state: "error",
      output,
      ms: Date.now() - started,
    });
    return { ledger, output };
  }

  if (toolId === "run_code") {
    // The code is on the trail before it runs; if that write fails, it does not run (ADR 0019).
    const input = parsed.value as { code: string };
    try {
      await emitStrict(ctx.runId, startEvent, {
        type: "code",
        callId: call.toolCallId,
        code: input.code,
        stdout: "",
        stderr: "",
        exitCode: CODE_PENDING,
        ms: 0,
      });
    } catch {
      return {
        ledger,
        output:
          "run_code refused: the audit trail could not record the code, so it was not run. Try again.",
      };
    }
  } else {
    await emit(ctx.runId, startEvent);
  }

  let next = ledger;
  let output = "";
  let finished: ToolOutcome["finished"];
  const extra: RunEventInput[] = [];
  let failed = false;

  switch (toolId) {
    case "outline":
      output = outlineText(document, candidates, ledger);
      break;
    case "read_pages": {
      const input = parsed.value as { from: number; to?: number };
      const read = readPages(document, input);
      const refused = read.text.startsWith("read_pages refused");
      output = refused
        ? read.text
        : asDocumentText(
            `pages="${input.from}-${input.to ?? input.from}"`,
            read.text,
          );
      if (read.read.length)
        next = { ...ledger, pagesRead: markRead(ledger.pagesRead, read.read) };
      else failed = refused;
      break;
    }
    case "grep": {
      const result = grepPages(
        document.pages,
        parsed.value as Parameters<typeof grepPages>[1],
      );
      output = result.ok
        ? asDocumentText('source="grep"', grepText(result))
        : grepText(result);
      failed = !result.ok;
      break;
    }
    case "run_code": {
      const input = parsed.value as { code: string };
      if (ledger.codeRuns >= RUN_LIMITS.codeRuns) {
        output = `run_code refused: this Run has used its ${RUN_LIMITS.codeRuns} code runs.`;
        failed = true;
        break;
      }
      const result = await runInSandbox({
        runId: ctx.runId,
        callId: call.toolCallId,
        code: input.code,
        document: async () => document,
        state: stateFiles(candidates, ledger),
      });
      next = { ...ledger, codeRuns: ledger.codeRuns + 1 };
      extra.push({
        type: "code",
        callId: call.toolCallId,
        code: input.code,
        ...result,
      });
      output = [
        `exit ${result.exitCode} · ${(result.ms / 1000).toFixed(1)} s`,
        result.stdout
          ? asDocumentText('source="run_code stdout"', result.stdout)
          : "stdout: (empty)",
        result.stderr
          ? asDocumentText('source="run_code stderr"', result.stderr)
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      failed = result.exitCode !== 0;
      break;
    }
    case "load_skill": {
      const { skill } = parsed.value as { skill: keyof typeof SKILLS };
      output = SKILLS[skill].body;
      if (!ledger.skills.includes(skill))
        next = { ...ledger, skills: [...ledger.skills, skill] };
      extra.push({ type: "skill", skill });
      break;
    }
    case "record_names": {
      const outcome = applyRecord({
        register: ledger.register,
        dismissed: ledger.dismissed,
        record: parsed.value as Parameters<typeof applyRecord>[0]["record"],
        pages: document.pages,
        candidates,
        rulebook: ctx.rulebook,
      });
      next = {
        ...ledger,
        register: outcome.register,
        dismissed: outcome.dismissed,
      };
      output = outcome.report.join("\n");
      if (outcome.changed)
        extra.push({ type: "names", names: forEvent(outcome.register) });
      break;
    }
    case "finish": {
      const gate = gateOf(document, candidates, ledger);
      if (gate.passed) {
        finished = { summary: (parsed.value as { summary: string }).summary };
        output = "Finished. The Done gate passed.";
      } else {
        output = gateRefusal(gate, candidates, ledger);
        failed = true;
      }
      break;
    }
    case "spawn_readers":
      output = "spawn_readers runs in the workflow, not here.";
      failed = true;
      break;
  }

  const gate = gateOf(document, candidates, next);
  const before = gateOf(document, candidates, ledger);
  if (
    gate.pagesRead !== before.pagesRead ||
    gate.candidatesOpen !== before.candidatesOpen ||
    toolId === "finish"
  ) {
    extra.push({ type: "gate", gate });
  }
  const shown = cap(output);
  await emit(ctx.runId, ...extra, {
    ...startEvent,
    state: failed ? "error" : "done",
    output: shown.slice(0, 4000),
    ms: Date.now() - started,
  });
  return {
    ledger: next,
    output: finished ? shown : `${shown}\n\n${gateLine(gate, next)}`,
    ...(finished ? { finished } : {}),
  };
}

// spawn_readers --------------------------------------------------------------------------

export type ReaderPlan =
  | { kind: "refused"; output: string }
  | { kind: "jobs"; jobs: ReaderJob[]; notes: string[] };

/** Checks a spawn_readers call against the caps and turns it into Reader jobs. */
export async function planReaders(
  ctx: RunContext,
  ledger: Ledger,
  call: ToolCall,
): Promise<ReaderPlan> {
  const { document } = await prepare(ctx);
  const startEvent = {
    type: "tool" as const,
    callId: call.toolCallId,
    tool: "spawn_readers" as const,
    summary: summarise("spawn_readers", call.input),
    input: call.input,
    state: "start" as const,
  };
  const refuse = async (output: string): Promise<ReaderPlan> => {
    await emit(ctx.runId, startEvent, {
      ...startEvent,
      state: "error",
      output,
    });
    return { kind: "refused", output };
  };
  const parsed = parseInput("spawn_readers", call.input);
  if (!parsed.ok) return refuse(`spawn_readers refused: ${parsed.error}`);
  const input = parsed.value as {
    ranges: { from: number; to: number; focus?: string }[];
    model?: string;
    instructions?: string;
  };
  const left = RUN_LIMITS.readers - ledger.readers.length;
  if (left <= 0)
    return refuse(
      `spawn_readers refused: this Run has used its ${RUN_LIMITS.readers} Readers. Cover the rest with read_pages.`,
    );
  const model = input.model ?? ctx.models.reader;
  const modelRefusal = readerModelRefusal(model, ctx.models.reader);
  if (modelRefusal) return refuse(modelRefusal);
  // The Readers are the Run's biggest spend: none starts on a Run that is already over.
  if (isOver(await runSink().status(ctx.runId)))
    return refuse("spawn_readers refused: the Run is over.");
  const planned = planReaderRanges({
    pages: document.pages,
    ranges: input.ranges,
    model,
    readersLeft: left,
    spentUsd: ledger.costUsd,
    overheadTokens: readerOverheadTokens(
      ctx.rulebook,
      ctx.rulebookVersion,
      input.instructions,
    ),
  });
  const notes = planned.notes;
  const jobs: ReaderJob[] = planned.ranges.map((range, index) => ({
    readerId: `${call.toolCallId}-${index + 1}`,
    from: range.from,
    to: range.to,
    model,
    ...(range.focus ? { focus: range.focus } : {}),
    ...(input.instructions ? { instructions: input.instructions } : {}),
  }));
  if (jobs.length === 0)
    return refuse(`spawn_readers refused: ${notes.join(" ")}`);
  await emit(ctx.runId, startEvent);
  return { kind: "jobs", jobs, notes };
}

/** Runs one Reader and tells the trail. Called as its own step, many in parallel. */
export async function readOneRange(
  ctx: RunContext,
  job: ReaderJob,
): Promise<ReaderResult> {
  // A Run stopped or failed while earlier Readers ran starts no more of them.
  if (isOver(await runSink().status(ctx.runId)))
    return {
      readerId: job.readerId,
      from: job.from,
      to: job.to,
      model: job.model,
      names: [],
      dropped: 0,
      cost: null,
      error: "The Run is over; this Reader was not started.",
      ms: 0,
    };
  const { document } = await prepare(ctx);
  await emit(ctx.runId, {
    type: "reader",
    readerId: job.readerId,
    from: job.from,
    to: job.to,
    state: "start",
  });
  const result = await runReader(ctx, document.pages, job);
  const events: RunEventInput[] = [];
  if (result.cost) events.push(result.cost);
  if (result.dropped > 0)
    events.push({
      type: "log",
      level: "warn",
      text: `Reader ${job.from}-${job.to}: dropped ${result.dropped} mention${result.dropped === 1 ? "" : "s"} whose quote is not verbatim on its page`,
    });
  if (result.error)
    events.push({
      type: "log",
      level: "error",
      text: `Reader ${job.from}-${job.to} failed: ${result.error}`,
    });
  events.push({
    type: "reader",
    readerId: job.readerId,
    from: job.from,
    to: job.to,
    state: result.error ? "error" : "done",
    names: result.names.length,
    ms: result.ms,
  });
  await emit(ctx.runId, ...events);
  return result;
}

/** Folds the Readers' names into the Register and marks their pages read. */
export async function mergeReaders(
  ctx: RunContext,
  ledger: Ledger,
  call: ToolCall,
  plan: { jobs: ReaderJob[]; notes: string[] },
  results: ReaderResult[],
  started: number,
): Promise<ToolOutcome> {
  const { document, candidates } = await prepare(ctx);
  const ok = results.filter((result) => !result.error);
  const register = mergeNames(
    ledger.register,
    ok.flatMap((result) => result.names),
    ctx.rulebook,
  );
  const pagesRead = markRead(
    ledger.pagesRead,
    ok.flatMap((result) =>
      Array.from(
        { length: result.to - result.from + 1 },
        (_, index) => result.from + index,
      ),
    ),
  );
  const next: Ledger = {
    ...ledger,
    register,
    pagesRead,
    readers: [
      ...ledger.readers,
      ...results.map((result) => ({
        readerId: result.readerId,
        from: result.from,
        to: result.to,
        model: result.model,
        names: result.names.length,
        dropped: result.dropped,
        ...(result.error ? { error: result.error } : {}),
      })),
    ],
    costUsd:
      ledger.costUsd +
      results.reduce((sum, result) => sum + (result.cost?.costUsd ?? 0), 0),
  };
  const gate = gateOf(document, candidates, next);
  const failed = results.filter((result) => result.error);
  const lines = [
    `${ok.length} of ${results.length} Readers finished; ${ok.reduce((sum, result) => sum + result.names.length, 0)} names returned, Register now ${register.length} Names.`,
    ...results.map(
      (result) =>
        `- ${result.from}-${result.to}: ${result.error ? `FAILED (${result.error.slice(0, 160)}); pages not counted as read` : `${result.names.length} names${result.dropped ? `, ${result.dropped} unverifiable mentions dropped` : ""}`}`,
    ),
    ...plan.notes,
  ];
  if (gate.pagesRead < gate.pagesTotal)
    lines.push(
      `Still unread: ${rangesText(unreadRanges(gate.pagesTotal, pagesRead))}.`,
    );
  const output = cap(lines.join("\n"));
  await emit(
    ctx.runId,
    { type: "names", names: forEvent(register) },
    { type: "gate", gate },
    {
      type: "tool",
      callId: call.toolCallId,
      tool: "spawn_readers",
      summary: summarise("spawn_readers", call.input),
      input: call.input,
      state: failed.length === results.length ? "error" : "done",
      output: output.slice(0, 4000),
      ms: Date.now() - started,
    },
  );
  return { ledger: next, output: `${output}\n\n${gateLine(gate, next)}` };
}

// End ------------------------------------------------------------------------------------

function corpusScore(
  ctx: RunContext,
  names: ExtractedName[],
): Score | undefined {
  if (ctx.source.kind !== "corpus") return undefined;
  const corpusId = ctx.source.corpusId;
  if (!CORPUS.some((entry) => entry.id === corpusId)) return undefined;
  // Score against what this Rulebook asks for: no handle-only parties when
  // handles are off, only the entity types it extracts.
  const expected = answerKeyFor(
    generateDocument(corpusId).answerKey,
    ctx.rulebook,
  ).filter((name) => ctx.rulebook.entityTypes.includes(name.type));
  return scoreNames(names, expected);
}

/** The status of a Run row that is over; a row that is gone counts as failed. */
function overStatus(
  status: RunStatus | null,
): "completed" | "failed" | "stopped" {
  return status === "completed" || status === "stopped" ? status : "failed";
}

export type EndOutcome =
  | {
      status: "completed";
      summary?: string;
      note?: string;
      /** Set when the harness wound the Run up before the Done gate passed. */
      stoppedBy?: StopReason;
    }
  | { status: "failed"; error: string };

/**
 * Ends the Run: applies the Rulebook to the Register, scores a Corpus
 * Document, writes the last events and the row, and stops the Sandbox. A Run
 * already over (stopped by its Owner, failed elsewhere) keeps its status and
 * gets no second end event.
 */
export async function end(
  ctx: RunContext,
  ledger: Ledger,
  outcome: EndOutcome,
): Promise<{ status: "completed" | "failed" | "stopped"; score?: Score }> {
  try {
    const before = await runSink().status(ctx.runId);
    if (isOver(before)) return { status: overStatus(before) };
    let names = ledger.register;
    let score: Score | undefined;
    let gate: DoneGate | undefined;
    try {
      const { document, candidates } = await prepare(ctx);
      names = applyRulebook(ledger.register, ctx.rulebook);
      score = corpusScore(ctx, names);
      gate = gateOf(document, candidates, ledger);
    } catch (error) {
      if (outcome.status === "completed") throw error;
    }
    const events: RunEventInput[] = [];
    if (outcome.status === "completed" && outcome.summary)
      events.push({ type: "thought", text: outcome.summary });
    if (outcome.status === "completed" && outcome.note)
      events.push({ type: "log", level: "warn", text: outcome.note });
    if (outcome.status === "failed")
      events.push({ type: "log", level: "error", text: outcome.error });
    events.push({ type: "names", names });
    if (gate) events.push({ type: "gate", gate });
    // What the Run did is on the trail before the row says it is over; the
    // `end` event follows only if this call is the one that ended the row, so a
    // Run stopped meanwhile never gets a second, contradicting end.
    await emit(ctx.runId, ...events);
    const ended = await runSink().end(ctx.runId, {
      status: outcome.status,
      names,
      score: score ?? null,
      cost_usd: Number(ledger.costUsd.toFixed(6)),
      error: outcome.status === "failed" ? outcome.error.slice(0, 1000) : null,
      gate_passed: gate?.passed ?? false,
      stopped_by:
        outcome.status === "completed" && outcome.stoppedBy
          ? outcome.stoppedBy
          : null,
    });
    if (!ended)
      return { status: overStatus(await runSink().status(ctx.runId)) };
    await emit(ctx.runId, {
      type: "end",
      status: outcome.status,
      gatePassed: gate?.passed ?? false,
      ...(outcome.status === "completed" && outcome.stoppedBy
        ? { stoppedBy: outcome.stoppedBy }
        : {}),
      ...(outcome.status === "failed" ? { error: outcome.error } : {}),
      ...(score ? { score } : {}),
    });
    return { status: outcome.status, ...(score ? { score } : {}) };
  } finally {
    await disposeSandbox(ctx.runId);
    prepared.delete(ctx.runId);
  }
}
