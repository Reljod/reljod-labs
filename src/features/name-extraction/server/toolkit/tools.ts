/**
 * The Analyst's tools as the model sees them: a description and an input
 * schema each, and no `execute`. The model's tool calls come back to the
 * workflow, which runs each one as its own durable step.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  MODEL_IDS,
  type ModelId,
  SKILL_IDS,
  TOOLS,
  type ToolId,
} from "../../domain/contract";
import { GREP_LIMITS } from "./grep";
import { recordNamesSchema } from "./register";
import { RUN_LIMITS } from "./state";

export const outlineSchema = z.object({});

export const readPagesSchema = z.object({
  from: z.number().int().min(1).describe("First page, 1-based"),
  to: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `Last page, inclusive; at most ${RUN_LIMITS.pagesPerRead} pages per call`,
    ),
});

export const grepSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .max(GREP_LIMITS.patternChars)
    .describe("JavaScript regular expression source, without slashes"),
  flags: z
    .string()
    .max(4)
    .optional()
    .describe("Any of i, m, s, u; g is implied"),
  from: z.number().int().min(1).optional().describe("First page to search"),
  to: z.number().int().min(1).optional().describe("Last page to search"),
  maxHits: z
    .number()
    .int()
    .min(1)
    .max(GREP_LIMITS.maxHits)
    .optional()
    .describe(
      `Hits to show (default ${GREP_LIMITS.defaultHits}); counts cover all`,
    ),
  context: z
    .number()
    .int()
    .min(0)
    .max(GREP_LIMITS.contextChars)
    .optional()
    .describe("Characters of context each side"),
});

export const runCodeSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      "An ES module run with node in the Sandbox. Import helpers from /vercel/doc/sieve.mjs; print results with out() or console.log",
    ),
  purpose: z
    .string()
    .max(200)
    .optional()
    .describe("One line on what the code is for, for the audit trail"),
});

export const spawnReadersSchema = z.object({
  ranges: z
    .array(
      z.object({
        from: z.number().int().min(1),
        to: z.number().int().min(1),
        focus: z
          .string()
          .max(300)
          .optional()
          .describe("What to look for in this range"),
      }),
    )
    .min(1)
    .max(RUN_LIMITS.readersPerCall)
    .describe(
      `Page ranges, about 20 pages each with 1 page of overlap; at most ${RUN_LIMITS.pagesPerReader} pages per range`,
    ),
  model: z
    .enum(MODEL_IDS as [ModelId, ...ModelId[]])
    .optional()
    .describe(
      "Reader model for this call only, e.g. a second model family for the recall audit; default is the Run's Reader model. Refused unless its input and output prices are both no higher than the Run's Reader model",
    ),
  instructions: z
    .string()
    .max(1000)
    .optional()
    .describe("Extra instructions for every Reader of this call"),
});

export const loadSkillSchema = z.object({
  skill: z.enum(SKILL_IDS),
});

export const finishSchema = z.object({
  summary: z
    .string()
    .max(2000)
    .describe("What you did, what is in doubt and why, for the audit trail"),
});

export const TOOL_SCHEMAS = {
  outline: outlineSchema,
  read_pages: readPagesSchema,
  grep: grepSchema,
  run_code: runCodeSchema,
  spawn_readers: spawnReadersSchema,
  load_skill: loadSkillSchema,
  record_names: recordNamesSchema,
  finish: finishSchema,
} satisfies Record<ToolId, z.ZodType>;

export type ToolInput<T extends ToolId> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

const DESCRIPTIONS: Record<ToolId, string> = {
  outline: `${TOOLS.outline.hint}. Call it first.`,
  read_pages: `${TOOLS.read_pages.hint}: at most ${RUN_LIMITS.pagesPerRead} pages per call. Pages shown whole count as read for the Done gate.`,
  grep: `${TOOLS.grep.hint}. Use it to find where a name or a field appears.`,
  run_code: `${TOOLS.run_code.hint}. Pages at /vercel/doc/pages/0001.txt…, candidates.json, register.json, readers.json and the helper module /vercel/doc/sieve.mjs. 60 s limit, output capped. Load the sandbox-coding Skill before the first use.`,
  spawn_readers: `${TOOLS.spawn_readers.hint}. Give every range in one call. Each Reader returns names with verbatim quotes, merged into the Register; its pages count as read when it succeeds. Each Reader's worst-case cost is reserved before it runs; ranges that would take the Run past its $${RUN_LIMITS.costUsd.toFixed(2)} spend cap are refused.`,
  load_skill: TOOLS.load_skill.hint,
  record_names: `${TOOLS.record_names.hint}, merges aliases, removes non-parties and dismisses Sweep Candidates with a reason. The only way to change the Register.`,
  finish: TOOLS.finish.hint,
};

/** The tool set for `generateText`, with no `execute`: tool calls come back unexecuted. */
export function analystTools() {
  return {
    outline: tool({
      description: DESCRIPTIONS.outline,
      inputSchema: outlineSchema,
    }),
    read_pages: tool({
      description: DESCRIPTIONS.read_pages,
      inputSchema: readPagesSchema,
    }),
    grep: tool({ description: DESCRIPTIONS.grep, inputSchema: grepSchema }),
    run_code: tool({
      description: DESCRIPTIONS.run_code,
      inputSchema: runCodeSchema,
    }),
    spawn_readers: tool({
      description: DESCRIPTIONS.spawn_readers,
      inputSchema: spawnReadersSchema,
    }),
    load_skill: tool({
      description: DESCRIPTIONS.load_skill,
      inputSchema: loadSkillSchema,
    }),
    record_names: tool({
      description: DESCRIPTIONS.record_names,
      inputSchema: recordNamesSchema,
    }),
    finish: tool({
      description: DESCRIPTIONS.finish,
      inputSchema: finishSchema,
    }),
  };
}

export function isToolId(value: string): value is ToolId {
  return value in TOOLS;
}

/** A short form of a tool call for the timeline. */
export function summarise(toolId: ToolId, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  switch (toolId) {
    case "outline":
      return "outline";
    case "read_pages":
      return `pages ${value.from}${value.to && value.to !== value.from ? `-${value.to}` : ""}`;
    case "grep":
      return `/${String(value.pattern ?? "").slice(0, 80)}/${value.flags ?? ""}`;
    case "run_code":
      return String(value.purpose ?? "").slice(0, 120) || "code";
    case "spawn_readers": {
      const ranges = Array.isArray(value.ranges) ? value.ranges : [];
      return `${ranges.length} reader${ranges.length === 1 ? "" : "s"}${value.model ? ` on ${value.model}` : ""}`;
    }
    case "load_skill":
      return String(value.skill ?? "");
    case "record_names": {
      const parts = [
        Array.isArray(value.add) && value.add.length
          ? `add ${value.add.length}`
          : "",
        Array.isArray(value.merge) && value.merge.length
          ? `merge ${value.merge.length}`
          : "",
        Array.isArray(value.remove) && value.remove.length
          ? `remove ${value.remove.length}`
          : "",
        Array.isArray(value.dismiss) && value.dismiss.length
          ? `dismiss ${value.dismiss.reduce((sum: number, group: { ids?: unknown[] }) => sum + (group.ids?.length ?? 0), 0)}`
          : "",
      ].filter(Boolean);
      return parts.join(", ") || "nothing";
    }
    case "finish":
      return "finish";
  }
}
