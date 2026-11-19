import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import { generateText, type ModelMessage } from "ai";
import {
  type CheckId,
  CODE_PENDING,
  checksFor,
  type Measurement,
  type PageInfo,
  type TrailEventInput,
} from "../domain/contract";
import { recordedMeasurements, samplePages } from "../domain/corpus";
import { findingLine, findingsToReview, trips } from "../domain/evaluate";
import { RUN_LIMITS } from "../domain/limits";
import { asMeasurements } from "../domain/score";
import { sql } from "./db";
import { documentOf } from "./document";
import { type EndOutcome, endExamination } from "./ending";
import { env } from "./env";
import { callOptions, trackCall } from "./llm";
import { IMAGE_MARK } from "./marks";
import { mcpHandler } from "./mcp";
import { signLoupeToken } from "./mcp-token";
import { examinerBrief, examinerInstructions } from "./prompt";
import {
  type ExaminationRow,
  type ExaminationState,
  getExamination,
  isOver,
  mutateState,
  updateExamination,
} from "./repository";
import {
  prepareDocument,
  runSweep,
  SandboxUnavailable,
  SWEEP_CODE,
  TOOLKIT_README,
} from "./sandbox";
import { assetPath, download, upload } from "./storage";
import { examinerTools, isToolId } from "./tool-schemas";
import { standingOf } from "./tools";
import { emit } from "./trail";

/*
 * The Examiner's side of an Examination, one function per workflow step
 * (server/workflow.ts). The Examination's state lives in its row, changed
 * only by the tools; the workflow carries the conversation and nothing else.
 */

export type ToolCall = { toolCallId: string; toolName: string; input: unknown };

// Prepare and Sweep -------------------------------------------------------------------

export type Prepared =
  | { kind: "over" }
  | { kind: "ready"; driver: ExaminationState["driver"] };

/**
 * Opens the Document: renders its pages in the Sandbox and stores them in
 * the Examination's folder. Without a Sandbox (or for the e2e suite's
 * scripted Examination) a Sample falls back to its static pages.
 */
export async function prepare(examinationId: string): Promise<Prepared> {
  const row = await getExamination(examinationId);
  if (!row || isOver(row.status)) return { kind: "over" };
  await updateExamination(row.id, { status: "running" });
  const recorded = row.state.stub || !env.sandboxConfigured();
  let pages: PageInfo[];
  let kind = row.kind;
  if (recorded) {
    if (row.source.kind !== "sample")
      throw new SandboxUnavailable(
        "Sandbox unavailable: an Upload cannot be examined without it.",
      );
    pages = samplePages(row.source.sampleId);
  } else {
    const prepared = await prepareDocument(
      row.id,
      documentOf(row, row.state.origin),
    );
    await Promise.all(
      prepared.pages.map((page) =>
        upload(
          assetPath(row.owner, row.id, `pages/p${page.page}.jpg`),
          page.bytes,
        ),
      ),
    );
    pages = prepared.pages.map(({ bytes: _bytes, ...page }) => ({
      ...page,
      image: `pages/p${page.page}.jpg`,
    }));
    // The Owner said what it is, or the text layer did.
    if (kind === "other") kind = prepared.kindGuess;
  }
  await updateExamination(row.id, { pages, kind });
  await emit(
    row.id,
    {
      type: "start",
      document: { title: row.title, kind, format: row.format },
      source: row.source,
      model: row.model,
      rulebookVersion: row.rulebook_version,
      driver: row.state.driver,
    },
    { type: "pages", pages },
  );
  return { kind: "ready", driver: row.state.driver };
}

/**
 * The Sweep: every Check that fits, no model. Live in the Sandbox when there
 * is one; a Sample otherwise uses the Measurements recorded when the Corpus
 * was rendered, and the Trail says so.
 */
export async function sweep(examinationId: string): Promise<void> {
  const row = await getExamination(examinationId);
  if (!row || isOver(row.status)) return;
  const checks = checksFor(row.format) as CheckId[];
  const recordedOnly = row.state.stub || !env.sandboxConfigured();
  const started = Date.now();
  let mode: "live" | "recorded" = recordedOnly ? "recorded" : "live";
  await emit(row.id, { type: "sweep", state: "start", mode, checks });
  let measurements: Measurement[] | null = null;
  const extra: TrailEventInput[] = [];

  if (!recordedOnly) {
    const pending = {
      type: "code" as const,
      callId: "sweep",
      check: null,
      code: SWEEP_CODE,
      stdout: "",
      stderr: "",
      exitCode: CODE_PENDING,
      ms: 0,
    };
    await emit(row.id, pending);
    const result = await runSweep({
      examinationId: row.id,
      document: documentOf(row, row.state.origin),
      kind: row.kind,
    });
    extra.push({
      ...pending,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ms: result.ms,
    });
    if (result.exitCode === 0) {
      await Promise.all(
        result.layers.map((layer) =>
          upload(
            assetPath(row.owner, row.id, `layers/sweep-${layer.name}`),
            layer.bytes,
          ),
        ),
      );
      measurements = asMeasurements(
        result.measurements,
        "sweep",
        "sweep",
        "s",
        (file) => `layers/sweep-${file}`,
      );
    } else if (row.source.kind !== "sample") {
      await emit(row.id, ...extra, {
        type: "sweep",
        state: "error",
        mode,
        checks,
        ms: Date.now() - started,
        error: "The Sweep failed in the Sandbox.",
      });
      throw new Error("The Sweep failed in the Sandbox.");
    } else {
      extra.push({
        type: "log",
        level: "warn",
        text: "The live Sweep failed; using the Sweep recorded when the Corpus was rendered.",
      });
    }
  }
  if (!measurements) {
    mode = "recorded";
    measurements =
      row.source.kind === "sample"
        ? recordedMeasurements(row.source.sampleId)
        : null;
    if (!measurements) throw new Error("No recorded Sweep for this Document.");
  }
  const taken = measurements;
  const changed = await mutateState(row.id, (current) => {
    const state: ExaminationState = {
      ...current.state,
      // The Sweep runs once; a retried step replaces its own Measurements.
      measurements: [
        ...taken,
        ...current.state.measurements.filter((item) => item.finder !== "sweep"),
      ],
      sweepMode: mode,
    };
    const standing = standingOf(current, state);
    return {
      state,
      patch: {
        findings: standing.findings,
        verdict: standing.verdict,
        gate: standing.gate,
      },
      result: standing,
    };
  });
  if ("refusal" in changed) throw new Error(changed.refusal);
  await emit(
    row.id,
    ...extra,
    {
      type: "sweep",
      state: "done",
      mode,
      checks,
      measurements: taken.length,
      ms: Date.now() - started,
    },
    { type: "measurements", measurements: taken },
    {
      type: "findings",
      findings: changed.result.findings,
      verdict: changed.result.verdict,
      rulebookVersion: row.rulebook_version,
    },
    { type: "gate", gate: changed.result.gate },
  );
}

/** The Examiner's first message: the Document and what the Sweep found. */
export async function opening(examinationId: string): Promise<ModelMessage[]> {
  const row = await getExamination(examinationId);
  if (!row) return [];
  const standing = standingOf(row, row.state);
  const lines = standing.findings.length
    ? standing.findings.map(
        (finding) =>
          `- ${finding.id} [${finding.weight}] page ${finding.page}${finding.box ? ` box [${finding.box.map((n) => n.toFixed(3)).join(", ")}]` : ""}: ${findingLine(finding)}. ${finding.detail}`,
      )
    : ["- No Measurement tripped a Rule."];
  const under = row.state.measurements.filter(
    (item) => !trips(item, row.kind, row.rulebook).tripped,
  ).length;
  return [
    {
      role: "user",
      content: examinerBrief({
        title: row.title,
        kind: row.kind,
        format: row.format,
        pages: row.pages.length,
        sweep: [
          ...lines,
          `${row.state.measurements.length} Measurements in all; ${under} under their thresholds. Verdict by the Rules so far: ${standing.verdict.verdict}.`,
        ].join("\n"),
      }),
    },
  ];
}

// One Examiner turn ---------------------------------------------------------------------

export type TurnResult =
  | { kind: "over" }
  | {
      kind: "turn";
      messages: ModelMessage[];
      toolCalls: ToolCall[];
      turns: number;
      costUsd: number;
    };

/**
 * Puts the last few looked-at images back into the conversation for the
 * model call. The workflow's history holds only their keys, so a page image
 * is never copied from step to step.
 */
async function withImages(
  row: ExaminationRow,
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  const marks: { message: number; part: number; key: string }[] = [];
  messages.forEach((message, m) => {
    if (message.role !== "user" || typeof message.content === "string") return;
    message.content.forEach((part, p) => {
      if (part.type !== "text") return;
      const key = IMAGE_MARK.exec(part.text)?.[1];
      if (key) marks.push({ message: m, part: p, key });
    });
  });
  const keep = marks.slice(-RUN_LIMITS.imagesInContext);
  const bytes = await Promise.all(
    keep.map((mark) => download(assetPath(row.owner, row.id, mark.key))),
  );
  const out = messages.map((message) =>
    message.role === "user" && typeof message.content !== "string"
      ? { ...message, content: [...message.content] }
      : message,
  ) as ModelMessage[];
  for (const mark of marks) {
    const index = keep.indexOf(mark);
    const image = index >= 0 ? bytes[index] : null;
    const content = out[mark.message].content as unknown[];
    content[mark.part] = image
      ? { type: "file", data: image, mediaType: "image/jpeg" }
      : {
          type: "text",
          text: "(An image you looked at earlier. Look again if you need it.)",
        };
  }
  return out;
}

async function addSpend(examinationId: string, costUsd: number) {
  const changed = await mutateState(examinationId, (current) => ({
    state: {
      ...current.state,
      counters: {
        ...current.state.counters,
        turns: current.state.counters.turns + 1,
      },
    },
    result: current.state.counters.turns + 1,
  }));
  await sql()`
    update loupe.examinations set cost_usd = cost_usd + ${Number(costUsd.toFixed(6))}
    where id = ${examinationId}`;
  return "refusal" in changed ? 0 : changed.result;
}

/** One Examiner model call, with tools that come back unexecuted. */
export async function turn(
  examinationId: string,
  messages: ModelMessage[],
): Promise<TurnResult> {
  const row = await getExamination(examinationId);
  // Stopped by its Owner, or failed or ended elsewhere: stop paying.
  if (!row || isOver(row.status)) return { kind: "over" };
  if (row.state.stub) return stubTurn(row, messages);
  const started = Date.now();
  const result = await generateText({
    ...callOptions(row.model),
    instructions: examinerInstructions({
      rulebook: row.rulebook,
      rulebookVersion: row.rulebook_version,
      kind: row.kind,
      toolkitReadme: TOOLKIT_README,
    }),
    messages: await withImages(row, messages),
    tools: examinerTools(),
    maxOutputTokens: RUN_LIMITS.outputTokens,
  });
  const cost = await trackCall({
    examinationId,
    model: row.model,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
    started,
  });
  const turns = await addSpend(examinationId, cost.costUsd);
  await emit(
    examinationId,
    ...(result.text.trim()
      ? [{ type: "thought" as const, text: result.text.trim() }]
      : []),
    cost,
  );
  const toolCalls = result.toolCalls.map((call) => {
    const invalid = call as { invalid?: boolean; error?: unknown };
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: invalid.invalid ? {} : call.input,
    };
  });
  return {
    kind: "turn",
    messages: [...messages, ...(result.response.messages as ModelMessage[])],
    toolCalls,
    turns,
    costUsd: row.cost_usd + cost.costUsd,
  };
}

// The e2e suite's scripted Examiner --------------------------------------------------------

/**
 * The e2e suite's Examiner: no model. It walks the same tools in a fixed
 * order decided from the Examination's state (look, a Hypothesis on the
 * strongest Sweep Finding, a Check, conclude, the reviews, finish), so the
 * Trail, the gate and the Verdict are real.
 */
async function stubTurn(
  row: ExaminationRow,
  messages: ModelMessage[],
): Promise<TurnResult> {
  const { state } = row;
  const standing = standingOf(row, state);
  const calls: { toolName: string; input: Record<string, unknown> }[] = [];
  let thought = "";
  const hypothesis = state.hypotheses[0];
  const lead = standing.findings.find((finding) => finding.box) ?? null;
  const unlooked = row.pages
    .map((page) => page.page)
    .filter((page) => !state.looked.includes(page));
  if (state.looked.length === 0) {
    thought = "Looking at the first page before anything else.";
    calls.push(
      { toolName: "look", input: { page: 1 } },
      { toolName: "load_skill", input: { skill: "writing-a-finding" } },
    );
  } else if (!hypothesis && lead && state.counters.checkRuns === 0) {
    thought =
      "One figure looks set differently from its neighbours. Recording that before testing it.";
    calls.push({
      toolName: "hypothesize",
      input: {
        page: lead.page,
        box: lead.box,
        claim: "This region looks set differently from the figures around it.",
      },
    });
  } else if (state.counters.checkRuns === 0) {
    const check = lead?.check ?? (row.format === "pdf" ? "arithmetic" : "ela");
    thought = `Testing it with the ${check} Check.`;
    calls.push({
      toolName: "run_check",
      input: { check, page: lead?.page ?? 1 },
    });
  } else if (hypothesis?.status === "open") {
    const mine = state.measurements.filter(
      (item) => item.finder === "examiner",
    );
    const tripping = mine.filter(
      (item) => trips(item, row.kind, row.rulebook).tripped,
    );
    const cite = tripping.length ? tripping : mine.slice(0, 1);
    thought = tripping.length
      ? "The Check measured it past the Rule's threshold."
      : "The numbers are ordinary; the Hypothesis does not hold.";
    calls.push({
      toolName: "conclude",
      input: {
        hypothesisId: hypothesis.id,
        outcome: tripping.length ? "supported" : "refuted",
        measurementIds: (cite.length
          ? cite
          : state.measurements.slice(0, 1)
        ).map((item) => item.id),
        explanation: tripping.length
          ? "The Check on this region measured a value past its Rule's threshold."
          : "The Check on this region measured nothing out of the ordinary.",
        confidence: tripping.length ? 0.8 : 0.6,
      },
    });
  } else if (unlooked.length || findingsToReview(standing.findings).length) {
    thought =
      "Covering the remaining pages and reviewing the Sweep's Findings.";
    for (const page of unlooked)
      calls.push({ toolName: "look", input: { page } });
    for (const finding of findingsToReview(standing.findings))
      calls.push({
        toolName: "review_finding",
        input: {
          findingId: finding.id,
          stance: "agree",
          note: "The measured value is past the Rule's threshold at this place.",
        },
      });
  } else if (!state.finished) {
    thought = "Every page was looked at and every Finding reviewed.";
    calls.push({
      toolName: "finish",
      input: {
        summary:
          "Scripted Examination: looked at every page, tested one Hypothesis with a Check and reviewed the Sweep's Findings.",
      },
    });
  }
  const turnNumber = state.counters.turns + 1;
  const toolCalls = calls.map((call, index) => ({
    toolCallId: `stub-${turnNumber}-${index + 1}`,
    ...call,
  }));
  const turns = await addSpend(row.id, 0);
  await emit(
    row.id,
    ...(thought ? [{ type: "thought" as const, text: thought }] : []),
    {
      type: "cost",
      model: "stub",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      ms: 1,
    },
  );
  return {
    kind: "turn",
    messages: [
      ...messages,
      {
        role: "assistant",
        content: [
          { type: "text", text: thought || "Done." },
          ...toolCalls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          })),
        ],
      },
    ],
    toolCalls,
    turns,
    costUsd: row.cost_usd,
  };
}

// Tools, through the MCP server -------------------------------------------------------------

export type ToolResult = {
  output: string;
  /** Asset key of an image the tool returned, for the next model call. */
  imageKey: string | null;
  /** `finish` passed the Done gate. */
  finished: boolean;
};

/** How long the Examiner's token for one tool call lasts. */
const TOKEN_SECONDS = 10 * 60;

type McpResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: { imageKey?: unknown; finished?: unknown };
};

/**
 * Runs one of the Examiner's tool calls through the Loupe MCP server, in
 * process, with a token bound to this Examination (ADR 0028). The server
 * checks the input, the caps and the Owner, and writes the Trail, exactly as
 * it does for an outside client.
 */
export async function callTool(
  examinationId: string,
  call: ToolCall,
): Promise<ToolResult> {
  const none = (output: string): ToolResult => ({
    output,
    imageKey: null,
    finished: false,
  });
  if (!isToolId(call.toolName)) return none(`Unknown tool "${call.toolName}".`);
  const row = await getExamination(examinationId);
  if (!row || isOver(row.status))
    return none("Not run: the Examination is over.");
  const token = signLoupeToken(
    {
      kind: "examiner",
      owner: row.owner,
      visitor: row.visitor_hash,
      trusted: row.state.stub,
      examinationId,
      origin: row.state.origin,
      exp: Math.floor(Date.now() / 1000) + TOKEN_SECONDS,
    },
    env.rateLimitSalt(),
  );
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: "http://loupe.internal/api/loupe/mcp",
      headers: { authorization: `Bearer ${token}` },
      fetch: (url, init) => mcpHandler(new Request(url, init)),
    },
  });
  try {
    const tools = (await client.tools()) as unknown as Record<
      string,
      {
        execute?: (
          args: Record<string, unknown>,
          options: { toolCallId: string; messages: [] },
        ) => Promise<unknown>;
      }
    >;
    const chosen = tools[call.toolName];
    if (!chosen?.execute) return none(`Unknown tool "${call.toolName}".`);
    const input =
      call.input && typeof call.input === "object"
        ? (call.input as Record<string, unknown>)
        : {};
    const result = (await chosen.execute(
      { ...input, examinationId },
      { toolCallId: call.toolCallId, messages: [] },
    )) as McpResult;
    const text = (result.content ?? [])
      .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
      .join("\n");
    const key = result.structuredContent?.imageKey;
    return {
      output: text || "(no output)",
      imageKey: typeof key === "string" ? key : null,
      finished: result.structuredContent?.finished === true,
    };
  } catch (error) {
    // The server refuses bad input with a message the model can act on.
    const message = error instanceof Error ? error.message : String(error);
    return none(`${call.toolName} refused: ${message.slice(0, 400)}`);
  } finally {
    await client.close().catch(() => {});
  }
}

// End ----------------------------------------------------------------------------------

export async function end(examinationId: string, outcome: EndOutcome) {
  if (outcome.status === "completed" && !outcome.summary) {
    const row = await getExamination(examinationId);
    const summary = row?.state.finished?.summary;
    if (summary) return endExamination(examinationId, { ...outcome, summary });
  }
  return endExamination(examinationId, outcome);
}

export async function note(examinationId: string, text: string) {
  await emit(examinationId, { type: "log", level: "warn", text });
}
