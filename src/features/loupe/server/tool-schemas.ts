/**
 * The input of each Examiner tool, once: the MCP server registers them with
 * `examinationId`, and the in-app Examiner's model sees them without it (the
 * harness fills it in, so the model cannot name another Examination).
 */
import { tool } from "ai";
import { z } from "zod";
import {
  boxSchema,
  CHECK_IDS,
  CHECKS,
  type CheckId,
  SKILL_IDS,
  TOOLS,
  type ToolId,
} from "../domain/contract";
import { RUN_LIMITS } from "../domain/limits";

const examinationId = z.string().uuid().describe("The Examination's id");
const page = z.number().int().min(1).max(200).describe("Page, 1-based");
const box = boxSchema
  .nullable()
  .optional()
  .describe(
    "Region as [x0, y0, x1, y1], each 0..1 of the page's width and height, origin top-left. Leave out for the whole page.",
  );

export const TOOL_INPUTS = {
  look: z.object({ page, box }),
  run_check: z.object({
    check: z
      .enum(CHECK_IDS as [CheckId, ...CheckId[]])
      .describe(
        CHECK_IDS.map((id) => `${id}: ${CHECKS[id].hint}`).join(". "),
      ),
    page: page.optional(),
    box,
  }),
  run_code: z.object({
    code: z
      .string()
      .min(1)
      .max(RUN_LIMITS.codeChars)
      .describe(
        "Python 3.14 run in the Sandbox (no network). `import loupe` for the Document and the Toolkit; record a number with loupe.report(metric, value, page, box, detail, facts).",
      ),
    purpose: z
      .string()
      .max(200)
      .optional()
      .describe("One line on what the code tests, for the Trail"),
  }),
  load_skill: z.object({
    skill: z.enum(SKILL_IDS),
  }),
  hypothesize: z.object({
    page,
    box,
    claim: z
      .string()
      .min(8)
      .max(400)
      .describe("What you see that suggests an alteration, concretely"),
  }),
  conclude: z.object({
    hypothesisId: z.string().regex(/^h\d{1,3}$/),
    outcome: z.enum(["supported", "refuted"]),
    measurementIds: z
      .array(z.string().regex(/^[sm]\d{1,4}$/))
      .max(12)
      .describe("Ids of the Measurements that tested it (m3, s12…)"),
    explanation: z
      .string()
      .min(8)
      .max(600)
      .describe("For the human reviewer: the place, the number, the threshold"),
    confidence: z.number().min(0).max(1).optional(),
  }),
  review_finding: z.object({
    findingId: z.string().regex(/^[sm]\d{1,4}$/),
    stance: z.enum(["agree", "doubt"]),
    note: z.string().min(4).max(500),
  }),
  finish: z.object({
    summary: z
      .string()
      .min(8)
      .max(1200)
      .describe(
        "For the reviewer: what was checked, what was found where, what was ruled out",
      ),
  }),
} as const satisfies Record<ToolId, z.ZodObject>;

/** Each tool's input with the Examination it acts on, as the MCP server takes it. */
export const MCP_INPUTS = {
  look: TOOL_INPUTS.look.extend({ examinationId }),
  run_check: TOOL_INPUTS.run_check.extend({ examinationId }),
  run_code: TOOL_INPUTS.run_code.extend({ examinationId }),
  hypothesize: TOOL_INPUTS.hypothesize.extend({ examinationId }),
  conclude: TOOL_INPUTS.conclude.extend({ examinationId }),
  review_finding: TOOL_INPUTS.review_finding.extend({ examinationId }),
  finish: TOOL_INPUTS.finish.extend({ examinationId }),
} as const;

const DESCRIPTIONS: Record<ToolId, string> = {
  look: "See a page, or a region of it zoomed in. The image comes back with the result. Every page must be looked at before finish.",
  run_check:
    "Run one named Check from the Toolkit on a page or a region. Returns Measurements with ids and whether each trips its Rule. With a box it always returns a number for that region.",
  run_code:
    "Run Python you write in the Sandbox with the Document and the Toolkit on disk and no network. Whatever it reports with loupe.report comes back as Measurements.",
  load_skill: "Load a Skill's playbook into context.",
  hypothesize:
    "Record what you suspect and where, before you test it. Returns the Hypothesis id.",
  conclude:
    "Settle a Hypothesis with the Measurements that tested it. 'supported' is refused unless one of them trips a Rule.",
  review_finding:
    "Say whether you agree with a Sweep Finding and why, for the reviewer. Your stance never changes the Verdict.",
  finish:
    "End the Examination. Refused until every page was looked at, every Sweep Finding reviewed and every Hypothesis settled.",
};

export function toolDescription(id: ToolId) {
  return `${DESCRIPTIONS[id]} (${TOOLS[id].hint}.)`;
}

/** The tools as the Examiner's model sees them: no `execute`; the workflow runs each call as a step. */
export function examinerTools() {
  return Object.fromEntries(
    (Object.keys(TOOL_INPUTS) as ToolId[]).map((id) => [
      id,
      tool({
        description: DESCRIPTIONS[id],
        inputSchema: TOOL_INPUTS[id] as z.ZodObject,
      }),
    ]),
  );
}

export function isToolId(name: string): name is ToolId {
  return name in TOOL_INPUTS;
}
