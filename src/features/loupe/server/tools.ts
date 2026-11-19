import "server-only";
import { randomUUID } from "node:crypto";
import type { Owner } from "@/features/access/domain/owner";
import {
  type Box,
  CHECKS,
  type CheckId,
  CODE_PENDING,
  type DoneGate,
  type Finder,
  type Finding,
  type Hypothesis,
  METRICS,
  type Measurement,
  type RawMeasurement,
  type SkillId,
  type ToolId,
  type TrailEventInput,
  type VerdictResult,
} from "../domain/contract";
import { RECORDED } from "../domain/corpus";
import {
  decide,
  doneGate,
  evaluate,
  testedByExaminer,
  trips,
} from "../domain/evaluate";
import { LIMITS, RUN_LIMITS } from "../domain/limits";
import { formatThreshold } from "../domain/rules";
import { asMeasurements } from "../domain/score";
import { SKILLS } from "../skills";
import { documentOf } from "./document";
import {
  audit,
  type ExaminationRow,
  type ExaminationState,
  isOver,
  mutateState,
  ownedExamination,
  takeRate,
} from "./repository";
import {
  checkCode,
  cropPage,
  type RunOutput,
  runCheck as sandboxCheck,
  runCode as sandboxCode,
} from "./sandbox";
import { assetPath, download, upload } from "./storage";
import { emit, emitStrict } from "./trail";

/*
 * The Examiner's tools and the Checks an Owner's client may run, as plain
 * server functions. The MCP server (server/mcp.ts) is the only caller: the
 * in-app Examiner and an outside client reach them through it, so both go
 * through the same Owner scoping, caps, Rules and Trail (ADR 0028).
 */

/** Who is calling a tool. Built by the MCP server from a verified token, never from tool input. */
export type Caller = {
  owner: Owner;
  visitor: { hash: string; trusted: boolean };
  /**
   * The in-app Examiner, bound to the one Examination it was started for,
   * or the Owner's own client.
   */
  role: { kind: "examiner"; examinationId: string } | { kind: "client" };
  /** Where the request came in, for a Sample's file. */
  origin: string;
};

export type ToolOutcome = {
  ok: boolean;
  text: string;
  /** An image for the caller to look at. */
  image?: { bytes: Buffer; mediaType: "image/jpeg" | "image/png"; key: string };
  data?: Record<string, unknown>;
};

const refusal = (text: string): ToolOutcome => ({ ok: false, text });

// What stands after a change ----------------------------------------------------------

export type Standing = {
  findings: Finding[];
  verdict: VerdictResult;
  gate: DoneGate;
};

/** The Findings, Verdict and Done gate of a state under the Examination's Rulebook. */
export function standingOf(
  row: Pick<ExaminationRow, "kind" | "rulebook" | "pages">,
  state: ExaminationState,
): Standing {
  const findings = evaluate({
    measurements: state.measurements,
    hypotheses: state.hypotheses,
    reviews: state.reviews,
    kind: row.kind,
    rulebook: row.rulebook,
  });
  return {
    findings,
    verdict: decide(findings, row.rulebook),
    gate: doneGate({
      pagesTotal: row.pages.length,
      pagesLooked: state.looked,
      findings,
      hypotheses: state.hypotheses,
    }),
  };
}

const standingPatch = (standing: Standing) => ({
  findings: standing.findings,
  verdict: standing.verdict,
  gate: standing.gate,
});

function standingEvents(
  row: Pick<ExaminationRow, "rulebook_version">,
  standing: Standing,
): TrailEventInput[] {
  return [
    {
      type: "findings",
      findings: standing.findings,
      verdict: standing.verdict,
      rulebookVersion: row.rulebook_version,
    },
    { type: "gate", gate: standing.gate },
  ];
}

/** One line of where the Examination stands, appended to tool results so the Examiner knows. */
export function gateLine(row: ExaminationRow, standing: Standing) {
  const { gate } = standing;
  const c = row.state.counters;
  return `[gate: pages looked ${gate.pagesLooked}/${gate.pagesTotal}, Sweep Findings to review ${gate.findingsOpen}, open Hypotheses ${gate.hypothesesOpen}, ${gate.passed ? "PASSED, you may finish" : "not passed"} · Findings ${standing.findings.filter((f) => f.weight !== "context").length} · code runs left ${RUN_LIMITS.codeRuns - c.codeRuns}, Checks left ${RUN_LIMITS.checkRuns - c.checkRuns}, looks left ${RUN_LIMITS.looks - c.looks} · spent $${row.cost_usd.toFixed(3)}]`;
}

// Access to an Examination -------------------------------------------------------------

/**
 * The Examination a tool may act on. It must be the caller's Owner's. The
 * in-app Examiner may touch only the Examination it was started for. The
 * Examiner's own tools (everything but `run_check`) need a going
 * Examination, and from a client one it drives itself.
 */
async function examinationFor(
  caller: Caller,
  examinationId: string,
  need: "examining" | "any",
): Promise<{ row: ExaminationRow } | { refusal: string }> {
  if (
    caller.role.kind === "examiner" &&
    caller.role.examinationId !== examinationId
  )
    return { refusal: "No such Examination." };
  const row = await ownedExamination(caller.owner, examinationId);
  if (!row) return { refusal: "No such Examination." };
  if (need === "any") return { row };
  if (isOver(row.status))
    return { refusal: "The Examination is over; its tools are closed." };
  if (caller.role.kind === "client" && row.state.driver !== "client")
    return {
      refusal:
        'This Examination has its own Examiner. Start one with mode "client" to drive the Examiner\'s tools yourself, or use run_check.',
    };
  if (row.pages.length === 0)
    return {
      refusal: "The Document is still being prepared. Try again shortly.",
    };
  return { row };
}

const OVER = "The Examination is over; its tools are closed.";

/**
 * `mutateState` for the Examiner's own tools: refused, under the same row
 * lock, once the Examination has ended, so a tool that began before a Stop
 * cannot change a finished Examination.
 */
const mutateLive: typeof mutateState = (examinationId, change) =>
  mutateState(examinationId, (row) =>
    isOver(row.status) ? { refusal: OVER } : change(row),
  );

const finderOf = (caller: Caller): Finder =>
  caller.role.kind === "examiner" ? "examiner" : "client";

function pageRefusal(row: ExaminationRow, page: number) {
  return page >= 1 && page <= row.pages.length
    ? null
    : `The Document has ${row.pages.length} page${row.pages.length === 1 ? "" : "s"}; page ${page} is not one.`;
}

// Describing Measurements to the caller -----------------------------------------------------

function boxText(box: Box | null) {
  return box ? `[${box.map((n) => n.toFixed(3)).join(", ")}]` : "whole page";
}

function measurementLine(row: ExaminationRow, measurement: Measurement) {
  const verdict = trips(measurement, row.kind, row.rulebook);
  const unit = METRICS[measurement.metric].unit;
  const rule = row.rulebook.rules[measurement.metric];
  const standing = !verdict.applies
    ? "no Rule applies (off, or not for this Document kind)"
    : verdict.tripped
      ? `TRIPS its Rule (threshold ${formatThreshold(verdict.threshold)} ${unit}, ${rule.weight})`
      : `under its Rule's threshold of ${formatThreshold(verdict.threshold)} ${unit}`;
  return `${measurement.id}: ${measurement.metric} = ${formatThreshold(verdict.value)} ${unit} on page ${measurement.page} ${boxText(measurement.box)} → ${standing}. ${measurement.detail}`;
}

// Taking a run's output into the Examination ---------------------------------------------------

/**
 * Stores what a run produced: its Evidence layers in the Examination's
 * folder, its Measurements in the state (under the row lock, with new ids),
 * and the Findings and Verdict as they now stand. Returns the new
 * Measurements and the standing.
 */
async function takeIn(input: {
  caller: Caller;
  row: ExaminationRow;
  callId: string;
  raw: RawMeasurement[];
  layers: { name: string; bytes: Buffer }[];
  check: CheckId | null;
  counter: "codeRuns" | "checkRuns" | null;
  /** Layer refs already servable (a recorded Sweep's static files). */
  staticLayers?: boolean;
}): Promise<
  | { added: Measurement[]; standing: Standing; row: ExaminationRow }
  | { refusal: string }
> {
  const { row, callId } = input;
  const safe = callId.replace(/[^\w-]/g, "_").slice(0, 60);
  const keyOf = (name: string) =>
    `layers/${safe}-${name.replace(/[^\w.-]/g, "_")}`;
  await Promise.all(
    input.layers.map((layer) =>
      upload(assetPath(row.owner, row.id, keyOf(layer.name)), layer.bytes),
    ),
  );
  const changed = await mutateState<{
    added: Measurement[];
    standing: Standing;
  }>(row.id, (current) => {
    // Decided under the lock: a Stop may have landed while the code ran.
    const ended = isOver(current.status);
    if (ended && input.caller.role.kind === "examiner")
      return { refusal: OVER };
    const start = current.state.counters.nextMeasurement;
    const added = asMeasurements(
      input.raw.map((item) => ({
        ...item,
        check: input.check ?? undefined,
      })),
      finderOf(input.caller),
      callId,
      "m",
      input.staticLayers ? (file) => file : keyOf,
      start,
    ).map((measurement) => ({
      ...measurement,
      // The Examiner's own code never gets to name a Check it did not run.
      check: input.check,
    }));
    const state: ExaminationState = {
      ...current.state,
      measurements: [...current.state.measurements, ...added],
      counters: {
        ...current.state.counters,
        nextMeasurement: start + added.length,
        ...(input.counter
          ? {
              [input.counter]: current.state.counters[input.counter] + 1,
            }
          : {}),
      },
    };
    // A Check run again on a finished Examination puts its Measurements on
    // record and leaves the Verdict as it was given: only Re-evaluate, which
    // is audited and scored, decides a finished Examination again.
    if (ended)
      return {
        state,
        result: { added, standing: standingOf(current, current.state) },
      };
    const standing = standingOf(current, state);
    return {
      state,
      patch: standingPatch(standing),
      result: { added, standing },
    };
  });
  if ("refusal" in changed) return changed;
  return { ...changed.result, row: changed.row };
}

function outputText(result: RunOutput) {
  return [
    `exit ${result.exitCode} · ${(result.ms / 1000).toFixed(1)} s`,
    result.stdout ? `stdout:\n${result.stdout}` : "stdout: (empty)",
    result.stderr ? `stderr:\n${result.stderr}` : "",
    result.rejected.length
      ? `Refused Measurements: ${result.rejected.join(" ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Wraps a tool call in its `tool` events on the Trail, whoever called it. */
async function traced(
  examinationId: string,
  tool: ToolId,
  callId: string,
  summary: string,
  input: unknown,
  work: () => Promise<ToolOutcome>,
  startStrict = false,
  extraStart: TrailEventInput[] = [],
): Promise<ToolOutcome> {
  const started = Date.now();
  const startEvent = {
    type: "tool" as const,
    callId,
    tool,
    summary,
    input,
    state: "start" as const,
  };
  if (startStrict) {
    try {
      await emitStrict(examinationId, startEvent, ...extraStart);
    } catch {
      return refusal(
        `${tool} refused: the Trail could not record it, so it was not run. Try again.`,
      );
    }
  } else {
    await emit(examinationId, startEvent, ...extraStart);
  }
  let outcome: ToolOutcome;
  try {
    outcome = await work();
  } catch (error) {
    console.error(`[loupe] ${tool} failed`, error);
    outcome = refusal(`${tool} failed on our side. Try again.`);
  }
  await emit(examinationId, {
    ...startEvent,
    state: outcome.ok ? "done" : "error",
    output: outcome.text.slice(0, 4000),
    ms: Date.now() - started,
  });
  return outcome;
}

export const newCallId = () => `c-${randomUUID().slice(0, 12)}`;

// look ------------------------------------------------------------------------------------

export async function look(
  caller: Caller,
  input: { examinationId: string; page: number; box?: Box | null },
  callId = newCallId(),
): Promise<ToolOutcome> {
  const found = await examinationFor(caller, input.examinationId, "examining");
  if ("refusal" in found) return refusal(found.refusal);
  const { row } = found;
  const box = input.box ?? null;
  return traced(
    row.id,
    "look",
    callId,
    box ? `page ${input.page}, region ${boxText(box)}` : `page ${input.page}`,
    input,
    async () => {
      const bad = pageRefusal(row, input.page);
      if (bad) return refusal(bad);
      if (row.state.counters.looks >= RUN_LIMITS.looks)
        return refusal(
          `look refused: this Examination has used its ${RUN_LIMITS.looks} looks.`,
        );
      let bytes: Buffer | null = null;
      if (!row.state.stub) {
        bytes = box
          ? await cropPage({
              examinationId: row.id,
              document: documentOf(row, caller.origin),
              callId,
              page: input.page,
              box,
            })
          : await pageBytes(row, input.page);
      }
      const key = `looks/${callId.replace(/[^\w-]/g, "_")}.jpg`;
      if (bytes) await upload(assetPath(row.owner, row.id, key), bytes);
      const changed = await mutateLive(row.id, (current) => {
        const state: ExaminationState = {
          ...current.state,
          looked: [...new Set([...current.state.looked, input.page])],
          counters: {
            ...current.state.counters,
            looks: current.state.counters.looks + 1,
          },
        };
        const standing = standingOf(current, state);
        return { state, patch: { gate: standing.gate }, result: standing };
      });
      if ("refusal" in changed) return refusal(changed.refusal);
      await emit(row.id, { type: "gate", gate: changed.result.gate });
      const page = row.pages[input.page - 1];
      const text = [
        box
          ? `Page ${input.page}, region ${boxText(box)}, zoomed in.`
          : `Page ${input.page} of ${row.pages.length}, ${page?.width}×${page?.height} px.`,
        bytes
          ? "The image follows. Boxes are [x0, y0, x1, y1], each 0..1 of the page, origin top-left."
          : "No image is available here (recorded mode).",
        gateLine(changed.row, changed.result),
      ].join("\n");
      return {
        ok: true,
        text,
        ...(bytes
          ? { image: { bytes, mediaType: "image/jpeg" as const, key } }
          : {}),
      };
    },
    false,
    [{ type: "look", callId, page: input.page, box }],
  );
}

/** A page image of an Examination from its own folder in the bucket. */
async function pageBytes(row: ExaminationRow, page: number) {
  const ref = row.pages[page - 1]?.image;
  if (!ref || ref.startsWith("/")) return null;
  return download(assetPath(row.owner, row.id, ref));
}

// run_check ---------------------------------------------------------------------------------

/** A Sample's recorded Sweep Measurements of one Check, for the e2e suite's scripted Examiner. */
function recordedCheck(row: ExaminationRow, check: CheckId): RawMeasurement[] {
  if (row.source.kind !== "sample") return [];
  const metrics = CHECKS[check].metrics as readonly string[];
  return (RECORDED.get(row.source.sampleId)?.measurements ?? [])
    .filter((item) => metrics.includes(item.metric))
    .slice(0, 4)
    .map((item) => ({ ...item, layer: undefined }));
}

export async function runCheck(
  caller: Caller,
  input: {
    examinationId: string;
    check: CheckId;
    page?: number;
    box?: Box | null;
  },
  callId = newCallId(),
): Promise<ToolOutcome> {
  // A client may run a Check on any of its Owner's Examinations, finished or not.
  const found = await examinationFor(
    caller,
    input.examinationId,
    caller.role.kind === "examiner" ? "examining" : "any",
  );
  if ("refusal" in found) return refusal(found.refusal);
  const { row } = found;
  if (row.pages.length === 0)
    return refusal("The Document is still being prepared. Try again shortly.");
  const spec = CHECKS[input.check];
  // A PDF page that is one scan takes the image Checks too; an image has no file structure.
  if (
    row.format === "image" &&
    !(spec.formats as readonly string[]).includes("image")
  )
    return refusal(
      `${input.check} is for ${spec.formats.join(" and ")} Documents; this one is an image.`,
    );
  if (input.page) {
    const bad = pageRefusal(row, input.page);
    if (bad) return refusal(bad);
  }
  const counted =
    caller.role.kind === "examiner" || row.state.driver === "client";
  if (counted && row.state.counters.checkRuns >= RUN_LIMITS.checkRuns)
    return refusal(
      `run_check refused: this Examination has used its ${RUN_LIMITS.checkRuns} Checks.`,
    );
  if (caller.role.kind === "client" && !caller.visitor.trusted) {
    const rate = await takeRate({
      owner: caller.owner,
      visitorHash: caller.visitor.hash,
      kind: "check",
      by: "visitor",
      limit: LIMITS.checksPerVisitorPerHour,
      windowHours: 1,
      what: "Checks",
    });
    if ("refusal" in rate) return refusal(rate.refusal);
  }
  const code = checkCode(input.check, input.page, input.box);
  const pending = {
    type: "code" as const,
    callId,
    check: input.check,
    code,
    stdout: "",
    stderr: "",
    exitCode: CODE_PENDING,
    ms: 0,
  };
  return traced(
    row.id,
    "run_check",
    callId,
    `${input.check}${input.page ? ` on page ${input.page}` : ""}${input.box ? `, region ${boxText(input.box)}` : ""}`,
    input,
    async () => {
      const result: RunOutput = row.state.stub
        ? {
            stdout: '{"ok": true, "recorded": true}',
            stderr: "",
            exitCode: 0,
            ms: 12,
            measurements: recordedCheck(row, input.check),
            layers: [],
            rejected: [],
          }
        : await sandboxCheck({
            examinationId: row.id,
            document: documentOf(row, caller.origin),
            callId,
            check: input.check,
            kind: row.kind,
            page: input.page,
            box: input.box,
            afterEnd: caller.role.kind === "client",
          });
      const taken = await takeIn({
        caller,
        row,
        callId,
        raw: result.exitCode === 0 ? result.measurements : [],
        layers: result.exitCode === 0 ? result.layers : [],
        check: input.check,
        counter: counted ? "checkRuns" : null,
      });
      if ("refusal" in taken) return refusal(taken.refusal);
      await emit(
        row.id,
        { ...pending, ...resultOf(result) },
        ...(taken.added.length
          ? [{ type: "measurements" as const, measurements: taken.added }]
          : []),
        ...standingEvents(taken.row, taken.standing),
      );
      if (caller.role.kind === "client")
        await audit(caller.owner, "check.run", "mcp", {
          examinationId: row.id,
          check: input.check,
          page: input.page ?? null,
          measurements: taken.added.length,
        }).catch(() => {});
      if (result.exitCode !== 0)
        return refusal(`${input.check} failed.\n${outputText(result)}`);
      const lines = taken.added.map((item) => measurementLine(taken.row, item));
      return {
        ok: true,
        text: [
          `${CHECKS[input.check].label}: ${taken.added.length} Measurement${taken.added.length === 1 ? "" : "s"} in ${(result.ms / 1000).toFixed(1)} s.`,
          ...(lines.length ? lines : ["Nothing measurable was found there."]),
          ...(isOver(taken.row.status)
            ? [
                "The Examination is over: these Measurements are on record and its Verdict stands as given. Re-evaluate decides it again with them.",
              ]
            : []),
          gateLine(taken.row, taken.standing),
        ].join("\n"),
        data: {
          measurements: taken.added,
          verdict: taken.standing.verdict.verdict,
        },
      };
    },
    true,
    [pending],
  );
}

const resultOf = (result: RunOutput) => ({
  stdout: result.stdout,
  stderr: result.stderr,
  exitCode: result.exitCode,
  ms: result.ms,
});

// run_code ----------------------------------------------------------------------------------

export async function runCode(
  caller: Caller,
  input: { examinationId: string; code: string; purpose?: string },
  callId = newCallId(),
): Promise<ToolOutcome> {
  const found = await examinationFor(caller, input.examinationId, "examining");
  if ("refusal" in found) return refusal(found.refusal);
  const { row } = found;
  if (row.state.counters.codeRuns >= RUN_LIMITS.codeRuns)
    return refusal(
      `run_code refused: this Examination has used its ${RUN_LIMITS.codeRuns} code runs.`,
    );
  const pending = {
    type: "code" as const,
    callId,
    check: null,
    code: input.code,
    stdout: "",
    stderr: "",
    exitCode: CODE_PENDING,
    ms: 0,
  };
  return traced(
    row.id,
    "run_code",
    callId,
    input.purpose?.slice(0, 120) ||
      `${input.code.split("\n").length} lines of Python`,
    input,
    async () => {
      const result: RunOutput = row.state.stub
        ? {
            stdout:
              "recorded run: no Sandbox in the e2e suite's scripted Examination\n",
            stderr: "",
            exitCode: 0,
            ms: 9,
            measurements: [],
            layers: [],
            rejected: [],
          }
        : await sandboxCode({
            examinationId: row.id,
            document: documentOf(row, caller.origin),
            callId,
            code: input.code,
          });
      const taken = await takeIn({
        caller,
        row,
        callId,
        raw: result.measurements,
        layers: result.layers,
        check: null,
        counter: "codeRuns",
      });
      if ("refusal" in taken) return refusal(taken.refusal);
      await emit(
        row.id,
        { ...pending, ...resultOf(result) },
        ...(taken.added.length
          ? [{ type: "measurements" as const, measurements: taken.added }]
          : []),
        ...standingEvents(taken.row, taken.standing),
      );
      const lines = taken.added.map((item) => measurementLine(taken.row, item));
      return {
        ok: result.exitCode === 0,
        text: [
          outputText(result),
          lines.length
            ? `Measurements reported:\n${lines.join("\n")}`
            : "No Measurement was reported (call loupe.report to record one).",
          gateLine(taken.row, taken.standing),
        ].join("\n"),
        data: { measurements: taken.added, exitCode: result.exitCode },
      };
    },
    true,
    [pending],
  );
}

// load_skill --------------------------------------------------------------------------------

export async function loadSkill(
  caller: Caller,
  input: { skill: SkillId; examinationId?: string },
  callId = newCallId(),
): Promise<ToolOutcome> {
  const skill = SKILLS[input.skill];
  if (caller.role.kind === "examiner" && !input.examinationId)
    return refusal("No such Examination.");
  if (!input.examinationId) return { ok: true, text: skill.body };
  const found = await examinationFor(caller, input.examinationId, "examining");
  if ("refusal" in found) return refusal(found.refusal);
  return traced(
    found.row.id,
    "load_skill",
    callId,
    input.skill,
    input,
    async () => {
      await mutateLive(found.row.id, (current) => ({
        state: current.state.skills.includes(input.skill)
          ? current.state
          : {
              ...current.state,
              skills: [...current.state.skills, input.skill],
            },
        result: null,
      }));
      await emit(found.row.id, { type: "skill", skill: input.skill });
      return { ok: true, text: skill.body };
    },
  );
}

// hypothesize -------------------------------------------------------------------------------

export async function hypothesize(
  caller: Caller,
  input: {
    examinationId: string;
    page: number;
    box?: Box | null;
    claim: string;
  },
  callId = newCallId(),
): Promise<ToolOutcome> {
  const found = await examinationFor(caller, input.examinationId, "examining");
  if ("refusal" in found) return refusal(found.refusal);
  const { row } = found;
  return traced(
    row.id,
    "hypothesize",
    callId,
    input.claim.slice(0, 140),
    input,
    async () => {
      const bad = pageRefusal(row, input.page);
      if (bad) return refusal(bad);
      const changed = await mutateLive<{
        hypothesis: Hypothesis;
        standing: Standing;
      }>(row.id, (current) => {
        if (current.state.hypotheses.length >= RUN_LIMITS.hypotheses)
          return {
            refusal: `hypothesize refused: this Examination has its ${RUN_LIMITS.hypotheses} Hypotheses. Settle the open ones.`,
          };
        const hypothesis: Hypothesis = {
          id: `h${current.state.hypotheses.length + 1}`,
          page: input.page,
          box: input.box ?? null,
          claim: input.claim.trim().slice(0, 400),
          status: "open",
          measurementIds: [],
          explanation: null,
          confidence: null,
        };
        const state: ExaminationState = {
          ...current.state,
          hypotheses: [...current.state.hypotheses, hypothesis],
        };
        const standing = standingOf(current, state);
        return {
          state,
          patch: { gate: standing.gate },
          result: { hypothesis, standing },
        };
      });
      if ("refusal" in changed) return refusal(changed.refusal);
      const { hypothesis, standing } = changed.result;
      await emit(
        row.id,
        { type: "hypothesis", hypothesis },
        { type: "gate", gate: standing.gate },
      );
      return {
        ok: true,
        text: `${hypothesis.id} recorded, open. Test it with run_check or run_code on that region, then conclude it with the Measurement ids.\n${gateLine(changed.row, standing)}`,
        data: { hypothesisId: hypothesis.id },
      };
    },
  );
}

// conclude ----------------------------------------------------------------------------------

export async function conclude(
  caller: Caller,
  input: {
    examinationId: string;
    hypothesisId: string;
    outcome: "supported" | "refuted";
    measurementIds: string[];
    explanation: string;
    confidence?: number;
  },
  callId = newCallId(),
): Promise<ToolOutcome> {
  const found = await examinationFor(caller, input.examinationId, "examining");
  if ("refusal" in found) return refusal(found.refusal);
  const { row } = found;
  return traced(
    row.id,
    "conclude",
    callId,
    `${input.hypothesisId} ${input.outcome}`,
    input,
    async () => {
      const changed = await mutateLive<{
        hypothesis: Hypothesis;
        standing: Standing;
        tripping: number;
      }>(row.id, (current) => {
        const hypothesis = current.state.hypotheses.find(
          (item) => item.id === input.hypothesisId,
        );
        if (!hypothesis)
          return {
            refusal: `conclude refused: no Hypothesis ${input.hypothesisId}.`,
          };
        const ids = [...new Set(input.measurementIds)];
        const measurements = ids.map((id) =>
          current.state.measurements.find((item) => item.id === id),
        );
        const unknown = ids.filter((_, index) => !measurements[index]);
        if (unknown.length)
          return {
            refusal: `conclude refused: no Measurement ${unknown.join(", ")}. Use the ids run_check and run_code returned.`,
          };
        // A Hypothesis is settled by code, never by the look alone.
        if (ids.length === 0)
          return {
            refusal:
              "conclude refused: a Hypothesis is settled by at least one Measurement. Run a Check or code on the region first.",
          };
        const known = measurements as Measurement[];
        const tripping = known.filter(
          (item) => trips(item, current.kind, current.rulebook).tripped,
        );
        if (input.outcome === "supported" && tripping.length === 0)
          return {
            refusal: `conclude refused: none of those Measurements trips a Rule, so the Hypothesis is not supported by them.\n${known.map((item) => measurementLine(current, item)).join("\n")}\nMeasure something else, or conclude it refuted.`,
          };
        const settled: Hypothesis = {
          ...hypothesis,
          status: input.outcome,
          measurementIds: ids,
          explanation: input.explanation.trim().slice(0, 600),
          confidence:
            typeof input.confidence === "number"
              ? Math.min(1, Math.max(0, input.confidence))
              : null,
        };
        const state: ExaminationState = {
          ...current.state,
          hypotheses: current.state.hypotheses.map((item) =>
            item.id === settled.id ? settled : item,
          ),
        };
        const standing = standingOf(current, state);
        return {
          state,
          patch: standingPatch(standing),
          result: { hypothesis: settled, standing, tripping: tripping.length },
        };
      });
      if ("refusal" in changed) return refusal(changed.refusal);
      const { hypothesis, standing } = changed.result;
      await emit(
        row.id,
        { type: "hypothesis", hypothesis },
        ...standingEvents(changed.row, standing),
      );
      const note =
        input.outcome === "refuted" && changed.result.tripping > 0
          ? " Note: a Measurement you cited does trip a Rule; it stays a Finding whatever the Hypothesis's outcome, because Rules decide."
          : "";
      return {
        ok: true,
        text: `${hypothesis.id} ${hypothesis.status}.${note}\n${gateLine(changed.row, standing)}`,
      };
    },
  );
}

// review_finding ----------------------------------------------------------------------------

export async function reviewFinding(
  caller: Caller,
  input: {
    examinationId: string;
    findingId: string;
    stance: "agree" | "doubt";
    note: string;
  },
  callId = newCallId(),
): Promise<ToolOutcome> {
  const found = await examinationFor(caller, input.examinationId, "examining");
  if ("refusal" in found) return refusal(found.refusal);
  const { row } = found;
  return traced(
    row.id,
    "review_finding",
    callId,
    `${input.findingId}: ${input.stance}`,
    input,
    async () => {
      const changed = await mutateLive<Standing>(row.id, (current) => {
        const before = standingOf(current, current.state);
        const finding = before.findings.find(
          (item) =>
            item.id === input.findingId ||
            item.measurementIds.includes(input.findingId),
        );
        if (!finding)
          return {
            refusal: `review_finding refused: no Finding ${input.findingId}. Findings: ${before.findings.map((item) => item.id).join(", ") || "none"}.`,
          };
        if (
          finding.weight === "decisive" &&
          !current.state.stub &&
          !testedByExaminer(finding, current.state.measurements)
        )
          return {
            refusal: `review_finding refused: ${finding.id} is decisive, so test it yourself first. Run run_check${finding.check ? ` ${finding.check}` : ""} (or run_code) on page ${finding.page || 1}${finding.box ? ` with box [${finding.box.map((n) => n.toFixed(3)).join(", ")}]` : ""}, then review it with what you measured.`,
          };
        const state: ExaminationState = {
          ...current.state,
          reviews: {
            ...current.state.reviews,
            [finding.id]: {
              stance: input.stance,
              note: input.note.trim().slice(0, 500),
            },
          },
        };
        const standing = standingOf(current, state);
        return { state, patch: standingPatch(standing), result: standing };
      });
      if ("refusal" in changed) return refusal(changed.refusal);
      await emit(row.id, ...standingEvents(changed.row, changed.result));
      return {
        ok: true,
        text: `Reviewed. Your stance is shown to the reviewer; the Verdict stays what the Rules decide.\n${gateLine(changed.row, changed.result)}`,
      };
    },
  );
}

// finish ------------------------------------------------------------------------------------

export function gateRefusal(standing: Standing, state: ExaminationState) {
  const { gate } = standing;
  const lines = ["finish refused: the Done gate has not passed."];
  if (gate.pagesLooked < gate.pagesTotal) {
    const missing = Array.from(
      { length: gate.pagesTotal },
      (_, index) => index + 1,
    ).filter((page) => !state.looked.includes(page));
    lines.push(`Not looked at yet: page ${missing.join(", ")}.`);
  }
  if (gate.findingsOpen > 0)
    lines.push(
      `Sweep Findings to review (review_finding): ${standing.findings
        .filter(
          (finding) =>
            finding.weight !== "context" &&
            finding.foundBy.includes("sweep") &&
            !finding.review &&
            !finding.hypothesisId,
        )
        .map(
          (finding) =>
            `${finding.id} (${finding.metric}, page ${finding.page})`,
        )
        .join("; ")}.`,
    );
  if (gate.hypothesesOpen > 0)
    lines.push(
      `Open Hypotheses (conclude): ${state.hypotheses
        .filter((item) => item.status === "open")
        .map((item) => item.id)
        .join(", ")}.`,
    );
  return lines.join("\n");
}

/**
 * Checks the Done gate. When it passes, the summary is kept on the state;
 * the workflow (or, for a client's own Examination, the MCP server) then
 * ends the Examination. The gate is code: the caller cannot talk its way past it.
 */
export async function finish(
  caller: Caller,
  input: { examinationId: string; summary: string },
  callId = newCallId(),
): Promise<ToolOutcome & { finished?: boolean }> {
  const found = await examinationFor(caller, input.examinationId, "examining");
  if ("refusal" in found) return refusal(found.refusal);
  const { row } = found;
  let finished = false;
  const outcome = await traced(
    row.id,
    "finish",
    callId,
    input.summary.slice(0, 140),
    input,
    async () => {
      const changed = await mutateLive<Standing>(row.id, (current) => {
        const standing = standingOf(current, current.state);
        if (!standing.gate.passed)
          return { refusal: gateRefusal(standing, current.state) };
        return {
          state: {
            ...current.state,
            finished: { summary: input.summary.trim().slice(0, 1200) },
          },
          patch: standingPatch(standing),
          result: standing,
        };
      });
      if ("refusal" in changed) {
        const standing = standingOf(row, row.state);
        await emit(row.id, { type: "gate", gate: standing.gate });
        return refusal(changed.refusal);
      }
      finished = true;
      await emit(row.id, { type: "gate", gate: changed.result.gate });
      return {
        ok: true,
        text: `Finished. The Done gate passed. Verdict by the Rules: ${changed.result.verdict.verdict}.`,
        data: { verdict: changed.result.verdict.verdict },
      };
    },
  );
  return { ...outcome, finished };
}
