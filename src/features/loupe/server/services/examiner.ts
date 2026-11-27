import { createMCPClient } from "@ai-sdk/mcp";
import type { ModelMessage } from "ai";
import {
  type CheckId,
  CODE_PENDING,
  checksFor,
  type Measurement,
  type PageInfo,
  type TrailEventInput,
} from "../../domain/contract";
import { recordedMeasurements, samplePages } from "../../domain/corpus";
import { findingLine, trips } from "../../domain/evaluate";
import { RUN_LIMITS } from "../../domain/limits";
import { asMeasurements } from "../../domain/score";
import {
  type ExaminationRow,
  type ExaminationState,
  isOver,
  standingOf,
} from "../examination";
import { IMAGE_MARK } from "../marks";
import { signLoupeToken } from "../mcp-token";
import type { EndOutcome, LoupePorts, ToolCall } from "../ports";
import { examinerBrief } from "../prompt";
import { assetPath } from "../storage";
import { isToolId } from "../tool-schemas";
import { SandboxUnavailable, SWEEP_CODE } from "../toolkit";
import type { Ending } from "./ending";
import type { Shared } from "./shared";

/*
 * The Examiner's side of an Examination, one method per workflow step
 * (server/steps.ts). The Examination's state lives in its row, changed only
 * by the tools; the workflow carries the conversation and nothing else.
 */

export type Prepared =
  | { kind: "over" }
  | { kind: "ready"; driver: ExaminationState["driver"] };

export type TurnResult =
  | { kind: "over" }
  | {
      kind: "turn";
      messages: ModelMessage[];
      toolCalls: ToolCall[];
      turns: number;
      costUsd: number;
    };

export type ToolResult = {
  output: string;
  /** Asset key of an image the tool returned, for the next model call. */
  imageKey: string | null;
  /** `finish` passed the Done gate. */
  finished: boolean;
};

export interface ExaminerService {
  /**
   * Opens the Document: renders its pages in the Sandbox and stores them in
   * the Examination's folder. Without a live Sandbox (the stub, or none set
   * up) a Sample falls back to its static pages.
   */
  prepare(examinationId: string): Promise<Prepared>;
  /**
   * The Sweep: every Check that fits, no model. Live in the Sandbox when
   * there is one; a Sample otherwise uses the Measurements recorded when the
   * Corpus was rendered, and the Trail says so.
   */
  sweep(examinationId: string): Promise<void>;
  /** The Examiner's first message: the Document and what the Sweep found. */
  opening(examinationId: string): Promise<ModelMessage[]>;
  /** One Examiner model call, with tools that come back unexecuted. */
  turn(examinationId: string, messages: ModelMessage[]): Promise<TurnResult>;
  /**
   * Runs one of the Examiner's tool calls through the Loupe MCP server, in
   * process, with a token bound to this Examination (ADR 0028). The server
   * checks the input, the caps and the Owner, and writes the Trail, exactly
   * as it does for an outside client.
   */
  callTool(examinationId: string, call: ToolCall): Promise<ToolResult>;
  end(
    examinationId: string,
    outcome: EndOutcome,
  ): Promise<{ status: "completed" | "failed" | "stopped" }>;
  note(examinationId: string, text: string): Promise<void>;
}

/** How long the Examiner's token for one tool call lasts. */
const TOKEN_SECONDS = 10 * 60;

type McpResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: { imageKey?: unknown; finished?: unknown };
};

export function createExaminerService(
  ports: Pick<
    LoupePorts,
    "examinations" | "store" | "sandbox" | "model" | "mcp" | "secret" | "now"
  > & { shared: Shared; ending: Ending },
): ExaminerService {
  const { examinations, store, sandbox, shared, ending } = ports;
  const { emit, documentOf } = shared;

  /**
   * Puts the last few looked-at images back into the conversation for the
   * model call. The workflow's history holds only their keys, so a page
   * image is never copied from step to step.
   */
  async function withImages(
    row: ExaminationRow,
    messages: ModelMessage[],
  ): Promise<ModelMessage[]> {
    const marks: { message: number; part: number; key: string }[] = [];
    messages.forEach((message, m) => {
      if (message.role !== "user" || typeof message.content === "string")
        return;
      message.content.forEach((part, p) => {
        if (part.type !== "text") return;
        const key = IMAGE_MARK.exec(part.text)?.[1];
        if (key) marks.push({ message: m, part: p, key });
      });
    });
    if (marks.length === 0) return messages;
    const keep = marks.slice(-RUN_LIMITS.imagesInContext);
    const bytes = await Promise.all(
      keep.map((mark) =>
        store.download(assetPath(row.owner, row.id, mark.key)),
      ),
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

  /** Counts a turn and adds its cost, under the row lock. The turn's number. */
  async function addSpend(examinationId: string, costUsd: number) {
    const changed = await examinations.mutate(examinationId, (current) => ({
      state: {
        ...current.state,
        counters: {
          ...current.state.counters,
          turns: current.state.counters.turns + 1,
        },
      },
      patch: {
        cost_usd: Number((current.cost_usd + costUsd).toFixed(6)),
      },
      result: current.state.counters.turns + 1,
    }));
    return "refusal" in changed ? 0 : changed.result;
  }

  return {
    async prepare(examinationId) {
      const row = await examinations.get(examinationId);
      if (!row || isOver(row.status)) return { kind: "over" };
      await examinations.update(row.id, { status: "running" });
      let pages: PageInfo[];
      let kind = row.kind;
      if (!sandbox.live) {
        if (row.source.kind !== "sample")
          throw new SandboxUnavailable(
            "Sandbox unavailable: an Upload cannot be examined without it.",
          );
        pages = samplePages(row.source.sampleId);
      } else {
        const prepared = await sandbox.prepare(
          row.id,
          documentOf(row, row.state.origin),
        );
        await Promise.all(
          prepared.pages.map((page) =>
            store.upload(
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
      await examinations.update(row.id, { pages, kind });
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
    },

    async sweep(examinationId) {
      const row = await examinations.get(examinationId);
      if (!row || isOver(row.status)) return;
      const checks = checksFor(row.format) as CheckId[];
      const recordedOnly = !sandbox.live;
      const started = ports.now();
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
        const result = await sandbox.sweep({
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
              store.upload(
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
            ms: ports.now() - started,
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
        if (!measurements)
          throw new Error("No recorded Sweep for this Document.");
      }
      const taken = measurements;
      const changed = await examinations.mutate(row.id, (current) => {
        const state: ExaminationState = {
          ...current.state,
          // The Sweep runs once; a retried step replaces its own Measurements.
          measurements: [
            ...taken,
            ...current.state.measurements.filter(
              (item) => item.finder !== "sweep",
            ),
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
          ms: ports.now() - started,
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
    },

    async opening(examinationId) {
      const row = await examinations.get(examinationId);
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
    },

    async turn(examinationId, messages) {
      const row = await examinations.get(examinationId);
      // Stopped by its Owner, or failed or ended elsewhere: stop paying.
      if (!row || isOver(row.status)) return { kind: "over" };
      const answered = await ports.model.turn(
        row,
        await withImages(row, messages),
      );
      const turns = await addSpend(examinationId, answered.cost.costUsd);
      await emit(
        examinationId,
        ...(answered.text
          ? [{ type: "thought" as const, text: answered.text }]
          : []),
        answered.cost,
      );
      return {
        kind: "turn",
        messages: [...messages, ...answered.messages],
        toolCalls: answered.toolCalls,
        turns,
        costUsd: row.cost_usd + answered.cost.costUsd,
      };
    },

    async callTool(examinationId, call) {
      const none = (output: string): ToolResult => ({
        output,
        imageKey: null,
        finished: false,
      });
      if (!isToolId(call.toolName))
        return none(`Unknown tool "${call.toolName}".`);
      const row = await examinations.pulse(examinationId);
      if (!row || isOver(row.status))
        return none("Not run: the Examination is over.");
      const token = signLoupeToken(
        {
          kind: "examiner",
          owner: row.owner,
          visitor: row.visitor_hash,
          trusted: row.stub,
          stub: row.stub,
          examinationId,
          origin: row.origin,
          exp: Math.floor(ports.now() / 1000) + TOKEN_SECONDS,
        },
        ports.secret(),
      );
      const client = await createMCPClient({
        transport: {
          type: "http",
          url: "http://loupe.internal/api/loupe/mcp",
          headers: { authorization: `Bearer ${token}` },
          fetch: (url, init) => ports.mcp(new Request(url, init)),
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
          .flatMap((part) =>
            part.type === "text" && part.text ? [part.text] : [],
          )
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
    },

    end: (examinationId, outcome) => ending.end(examinationId, outcome),

    async note(examinationId, text) {
      await emit(examinationId, { type: "log", level: "warn", text });
    },
  };
}
