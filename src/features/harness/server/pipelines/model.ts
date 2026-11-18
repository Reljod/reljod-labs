import "server-only";
import { generateText, isStepCount, Output } from "ai";
import { z } from "zod";
import type { AuditUsage } from "../../domain/audit";
import { LIMITS } from "../../domain/limits";
import { isIsoDate } from "../../domain/pipelines/dates";
import {
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPES,
} from "../../domain/pipelines/documents";
import type { DraftPlan } from "../../domain/pipelines/drafts";
import {
  classifyByKeywords,
  readByRules,
} from "../../domain/pipelines/extract";
import {
  type DocumentReading,
  MEMBER_NO,
  normaliseMemberNo,
} from "../../domain/pipelines/member-request";
import {
  MEMBER_REQUEST_KINDS,
  MEMBER_REQUEST_LABEL,
  type MemberRequestKind,
} from "../../domain/records";
import { SANDBOX_LIMITS } from "../../domain/sandbox";
import { env } from "../env";
import { addUsage, stepModel, usageOf } from "../llm";
import {
  RUN_CODE_HINT,
  type StepPaper,
  type StepScope,
  stepCode,
} from "./code";

/*
 * The model Steps: they read papers and write Drafts, never a Finding (ADR
 * 0015). Each has a deterministic fallback, used when the call fails or the
 * Run is stubbed (the e2e suite), so a Run always finishes; what the
 * fallback produced is marked `fallback: true`.
 */

export type ModelResult<T> = {
  value: T;
  usage: AuditUsage | null;
  fallback: boolean;
  /** Why the fallback was used, when it was. */
  reason: string | null;
};

async function withFallback<T>(
  stubbed: boolean,
  call: () => Promise<{ value: T; usage: AuditUsage }>,
  fallback: () => T,
): Promise<ModelResult<T>> {
  if (stubbed) {
    return {
      value: fallback(),
      usage: null,
      fallback: true,
      reason: "stubbed run",
    };
  }
  try {
    const { value, usage } = await call();
    return { value, usage, fallback: false, reason: null };
  } catch (error) {
    console.error(
      "[harness] model step fell back",
      error instanceof Error ? error.message : error,
    );
    return {
      value: fallback(),
      usage: null,
      fallback: true,
      reason: "the model call failed",
    };
  }
}

const cut = (text: string) => text.slice(0, LIMITS.sourceCharsPerStep);

/** Every step of a call that may have coded, added up (each step has its own gateway cost). */
function callUsage(result: {
  steps: {
    usage: Parameters<typeof usageOf>[0]["usage"];
    providerMetadata?: unknown;
  }[];
}): AuditUsage {
  const model = env.stepModel();
  return (
    addUsage(
      result.steps.map((step) =>
        usageOf({
          model,
          usage: step.usage,
          providerMetadata: step.providerMetadata,
        }),
      ),
    ) ?? usageOf({ model, usage: undefined })
  );
}

/**
 * A reading call that may code (ADR 0022): `run_code` for up to
 * `SANDBOX_LIMITS.stepCodeCalls` runs, then one last step with no tools, so
 * the structured answer always comes. Without a scope it is a plain call.
 * The Step's Sandbox is removed when the call ends, however it ends.
 */
async function withCode<T>(
  scope: StepScope | undefined,
  papers: StepPaper[],
  call: (options: {
    tools?: ReturnType<typeof stepCode>["tools"];
    stopWhen?: ReturnType<typeof isStepCount>;
    prepareStep?: (step: {
      stepNumber: number;
    }) => { toolChoice: "none" } | undefined;
    hint: string;
  }) => Promise<T>,
): Promise<T> {
  if (!scope) return call({ hint: "" });
  const code = stepCode(scope, papers);
  try {
    return await call({
      tools: code.tools,
      stopWhen: isStepCount(SANDBOX_LIMITS.stepCodeCalls + 1),
      prepareStep: ({ stepNumber }) =>
        stepNumber >= SANDBOX_LIMITS.stepCodeCalls
          ? { toolChoice: "none" }
          : undefined,
      hint: `\n\n${RUN_CODE_HINT}`,
    });
  } finally {
    await code.dispose();
  }
}

// classify ---------------------------------------------------------------------------------

const KIND_LIST = MEMBER_REQUEST_KINDS.map(
  (kind) => `- ${kind}: ${MEMBER_REQUEST_LABEL[kind]}`,
).join("\n");

const classifySchema = z.object({
  kind: z.enum([...MEMBER_REQUEST_KINDS, "unknown"] as [string, ...string[]]),
  confidence: z.number(),
  reason: z.string(),
});

export type Classification = {
  kind: MemberRequestKind | null;
  confidence: number;
  reason: string;
};

export async function classifyRequest(input: {
  texts: { title: string; text: string }[];
  stubbed: boolean;
  /** Lets the call code in a Sandbox; absent, it only reads. */
  code?: StepScope;
}): Promise<ModelResult<Classification>> {
  const joined = input.texts
    .map((item) => `## ${item.title}\n${item.text}`)
    .join("\n\n");
  return withFallback(
    input.stubbed,
    async () => {
      const result = await withCode(input.code, input.texts, (coding) =>
        generateText({
          model: stepModel(),
          tools: coding.tools,
          stopWhen: coding.stopWhen,
          prepareStep: coding.prepareStep,
          instructions: `You sort Member requests arriving at the Pensions Operations Desk of a Cayman Islands bank. Say which kind of request the papers make.

Kinds:
${KIND_LIST}

transfer_out is a transfer to another registered plan on changing employer. cessation_of_residence is a Member who has left the Islands and wants the money moved to a plan abroad, or asks for a cash refund (refunds on leaving ended in 2019). Answer "unknown" when the papers do not say. reason: one short sentence quoting the words that decided it. confidence: 0 to 1.${coding.hint}`,
          output: Output.object({ schema: classifySchema }),
          prompt: cut(joined),
        }),
      );
      const kind = (MEMBER_REQUEST_KINDS as readonly string[]).includes(
        result.output.kind,
      )
        ? (result.output.kind as MemberRequestKind)
        : null;
      return {
        value: {
          kind,
          confidence: Math.max(0, Math.min(1, result.output.confidence)),
          reason: result.output.reason.slice(0, 300),
        },
        usage: callUsage(result),
      };
    },
    () => {
      const found = classifyByKeywords(joined);
      return {
        kind: found.kind,
        confidence: found.kind ? 0.6 : 0,
        reason: found.reason,
      };
    },
  );
}

// read_documents -----------------------------------------------------------------------------

const PAPER_LIST = DOCUMENT_TYPES.map(
  (type) => `- ${type}: ${DOCUMENT_TYPE_LABEL[type]}`,
).join("\n");

const readSchema = z.object({
  papers: z.array(
    z.object({
      type: z.enum(DOCUMENT_TYPES as unknown as [string, ...string[]]),
      title: z.string(),
      signed: z.boolean().nullable(),
    }),
  ),
  memberNo: z.string().nullable(),
  fullName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  requestKind: z.enum([...MEMBER_REQUEST_KINDS, "unknown"] as [
    string,
    ...string[],
  ]),
  requestedAmountKyd: z.number().nullable(),
  propertyPurpose: z.enum(["deposit", "reduction", "payoff", "none"]),
  asksCashRefund: z.boolean(),
  receivingPlan: z.string().nullable(),
  dateOfDeath: z.string().nullable(),
});

export async function readPapers(input: {
  source: { id: string; title: string; text: string };
  stubbed: boolean;
  /** Lets the call code in a Sandbox; absent, it only reads. */
  code?: StepScope;
}): Promise<ModelResult<DocumentReading>> {
  const { source } = input;
  return withFallback(
    input.stubbed,
    async () => {
      const result = await withCode(input.code, [source], (coding) =>
        generateText({
          model: stepModel(),
          tools: coding.tools,
          stopWhen: coding.stopWhen,
          prepareStep: coding.prepareStep,
          instructions: `You read the papers of one Member request for a pension plan desk. Report only what the text says; never guess, never decide eligibility.

papers: every separate paper the text contains (a form, a letter, an ID copy, a certificate), each with its type from this list, its title as written, and whether it says it is signed (null if it does not say). A paper that is only promised ("will follow") is not there.
${PAPER_LIST}

memberNo: the plan's member number (like HB-10001) or null. fullName, dateOfBirth (YYYY-MM-DD), dateOfDeath (YYYY-MM-DD): as written, or null. requestKind: the kind the papers ask for, or "unknown". requestedAmountKyd: the amount asked for in Cayman Islands dollars, or null when it is "the full balance" or not stated. propertyPurpose: deposit, reduction or payoff for a property withdrawal, else "none". asksCashRefund: true only if the Member asks to be paid cash. receivingPlan: the plan the money would go to, or null.${coding.hint}`,
          output: Output.object({ schema: readSchema }),
          prompt: `Source: ${source.title}\n\n${cut(source.text)}`,
        }),
      );
      const out = result.output;
      const memberNo =
        out.memberNo && MEMBER_NO.test(out.memberNo)
          ? normaliseMemberNo(MEMBER_NO.exec(out.memberNo)?.[0] ?? out.memberNo)
          : null;
      const reading: DocumentReading = {
        sourceId: source.id,
        sourceTitle: source.title,
        papers: out.papers.map((paper) => ({
          type: paper.type as DocumentReading["papers"][number]["type"],
          title: paper.title.slice(0, 200),
          signed: paper.signed,
        })),
        memberNo,
        fullName: out.fullName?.slice(0, 160) ?? null,
        dateOfBirth:
          out.dateOfBirth && isIsoDate(out.dateOfBirth)
            ? out.dateOfBirth
            : null,
        requestKind: (MEMBER_REQUEST_KINDS as readonly string[]).includes(
          out.requestKind,
        )
          ? (out.requestKind as MemberRequestKind)
          : null,
        requestedAmountKyd:
          out.requestedAmountKyd !== null &&
          Number.isFinite(out.requestedAmountKyd) &&
          out.requestedAmountKyd >= 0
            ? out.requestedAmountKyd
            : null,
        propertyPurpose:
          out.propertyPurpose === "none"
            ? null
            : (out.propertyPurpose as DocumentReading["propertyPurpose"]),
        asksCashRefund: out.asksCashRefund,
        receivingPlan: out.receivingPlan?.slice(0, 200) ?? null,
        dateOfDeath:
          out.dateOfDeath && isIsoDate(out.dateOfDeath)
            ? out.dateOfDeath
            : null,
        fallback: false,
      };
      return {
        value: reading,
        usage: callUsage(result),
      };
    },
    () => readByRules(source),
  );
}

// Drafts ------------------------------------------------------------------------------------

/**
 * The model's text without a first line that only repeats the Draft's title
 * (as a heading or in bold): the Approval panel already shows the title.
 */
export function withoutTitle(text: string, title: string): string {
  const plain = (line: string) =>
    line
      .replace(/^#+\s*/, "")
      .replace(/^\*\*(.*)\*\*$/, "$1")
      .trim()
      .toLowerCase();
  const [first, ...rest] = text.trim().split("\n");
  return first !== undefined && plain(first) === plain(title)
    ? rest.join("\n").trim()
    : text.trim();
}

/** Writes a Draft's body from its plan. The particulars (every amount) are added by code afterwards. */
export async function writeDraftBody(input: {
  plan: DraftPlan;
  context: string;
  stubbed: boolean;
}): Promise<ModelResult<string>> {
  const { plan } = input;
  return withFallback(
    input.stubbed,
    async () => {
      const result = await generateText({
        model: stepModel(),
        instructions: `You draft correspondence for the Pensions Operations Desk of Harbour Bank & Trust, a fictional Cayman Islands bank. Write the body of one ${plan.kind.replace(/_/g, " ")} in plain, courteous English, in Markdown, under 220 words.

Rules:
- The decision is already made by the plan's Rules; never change it, add a reason or promise anything else.
- Do not write any amount, date or table: a particulars block with every figure is appended after your text. Refer to it ("set out below").
- Sign off as "Pensions Operations Desk, Harbour Bank & Trust" when it is a letter.
- No placeholders in square brackets.
- The title and the addressee are shown above your text: do not repeat them, and write no "To:", "From:" or "Subject:" lines. Begin with the greeting, or with the first sentence when there is none.

What it must say:
${plan.points.map((point) => `- ${point}`).join("\n")}`,
        prompt: `Title: ${plan.title}\nTo: ${plan.to ?? "internal"}\n\n${input.context}\n\nThe particulars that will follow your text:\n${plan.particulars}`,
        // A short Draft needs no thinking. With the default, Haiku 5.5 spent
        // the whole 700-token cap reasoning: the live Draft came back empty or
        // cut mid-sentence. Reasoning tokens count against the cap.
        reasoning: "none",
        maxOutputTokens: 2_000,
      });
      const body = withoutTitle(result.text, plan.title);
      if (!body) throw new Error("The model wrote nothing");
      // A Draft cut off at the cap would go to a person to approve as it is.
      if (result.finishReason === "length") {
        throw new Error("The model's Draft was cut off");
      }
      return {
        value: body,
        usage: usageOf({
          model: env.stepModel(),
          usage: result.usage,
          providerMetadata: result.providerMetadata,
        }),
      };
    },
    () => plan.fallbackBody,
  );
}
