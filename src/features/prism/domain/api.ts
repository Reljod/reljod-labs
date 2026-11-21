import { z } from "zod";
import { LIMITS } from "./limits";
import { DECISION_MODELS, type DecisionModelId } from "./models";

export const API_ROOT = "/api/prism";

const modelIds = DECISION_MODELS.map((m) => m.id) as [
  DecisionModelId,
  ...DecisionModelId[],
];

export const decisionModelIdSchema = z.enum(modelIds);

export const prismQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("boolean"),
    instructions: z.string().trim().min(1).max(400),
    criteria: z
      .object({
        true: z.string().trim().min(1).max(260).optional(),
        false: z.string().trim().min(1).max(260).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("choice"),
    instructions: z.string().trim().min(1).max(400),
    criteria: z
      .record(
        z.string().trim().min(1).max(48),
        z.string().trim().min(1).max(260),
      )
      .refine(
        (c) =>
          Object.keys(c).length >= 2 &&
          Object.keys(c).length <= LIMITS.maxOptionsPerQuestion,
        {
          message: `Choice questions need between 2 and ${LIMITS.maxOptionsPerQuestion} options.`,
        },
      ),
  }),
  z.object({
    type: z.literal("score"),
    instructions: z.string().trim().min(1).max(400),
    criteria: z
      .array(z.string().trim().min(1).max(260))
      .min(2)
      .max(LIMITS.maxOptionsPerQuestion),
  }),
]);

export const refractRequestSchema = z.object({
  modelId: decisionModelIdSchema,
  state: z.string().trim().min(1).max(LIMITS.maxStateChars),
  /** Omit to run the canonical 5-question Meridian Bank triage slate. */
  questions: z
    .record(z.string().trim().min(1).max(48), prismQuestionSchema)
    .refine(
      (q) =>
        Object.keys(q).length >= 1 &&
        Object.keys(q).length <= LIMITS.maxCustomQuestions,
      {
        message: `Provide between 1 and ${LIMITS.maxCustomQuestions} questions.`,
      },
    )
    .optional(),
});

export const tribunalRequestSchema = z.object({
  state: z.string().trim().min(1).max(LIMITS.maxStateChars),
  modelIds: z
    .array(decisionModelIdSchema)
    .min(2)
    .max(LIMITS.maxJurors)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Each juror model must be distinct.",
    }),
});

export const cascadeRequestSchema = z.object({
  modelId: decisionModelIdSchema,
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(32),
        text: z.string().trim().min(1).max(LIMITS.maxStateChars),
      }),
    )
    .min(1)
    .max(LIMITS.maxCascadeItems),
});

export type PrismAnswer =
  | { readonly type: "boolean"; readonly probability: number }
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities?: Readonly<Record<string, number>>;
    }
  | {
      readonly type: "score";
      readonly score: number;
      readonly probabilities?: Readonly<Record<string, number>>;
    };

export interface MeridianAnswers {
  readonly routing: {
    readonly type: "choice";
    readonly choice: string;
    readonly probabilities?: Readonly<Record<string, number>>;
  };
  readonly severity: {
    readonly type: "score";
    readonly score: number;
    readonly probabilities?: Readonly<Record<string, number>>;
  };
  readonly urgent: { readonly type: "boolean"; readonly probability: number };
  readonly adversarial: {
    readonly type: "boolean";
    readonly probability: number;
  };
  readonly humanSignoff: {
    readonly type: "boolean";
    readonly probability: number;
  };
}

export interface RefractResponse {
  readonly modelId: DecisionModelId;
  readonly resolvedModel: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly answers: Record<string, PrismAnswer>;
}

export type TribunalStreamEvent =
  | {
      readonly type: "juror.result";
      readonly modelId: DecisionModelId;
      readonly latencyMs: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly costUsd: number;
      readonly answers: MeridianAnswers;
    }
  | {
      readonly type: "juror.error";
      readonly modelId: DecisionModelId;
      readonly error: string;
    }
  | {
      readonly type: "tribunal.done";
      readonly wallMs: number;
    };

export type CascadeStreamEvent =
  | {
      readonly type: "item.decided";
      readonly id: string;
      readonly index: number;
      readonly latencyMs: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly costUsd: number;
      readonly answers: MeridianAnswers;
    }
  | {
      readonly type: "item.error";
      readonly id: string;
      readonly index: number;
      readonly error: string;
    }
  | {
      readonly type: "cascade.done";
      readonly wallMs: number;
      readonly totalInputTokens: number;
      readonly totalOutputTokens: number;
      readonly totalCostUsd: number;
    };
