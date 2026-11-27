import {
  type AnswerResponse,
  questionParamsSchema,
} from "@/features/casework/domain/api";
import { answerSchema } from "@/features/casework/domain/run-events";
import { caseworkApi, withDesk } from "@/features/casework/server/api";
import { body, params } from "@/platform/http/middleware";

/** Answers a waiting Run's Question; 404 for a Question of any other Desk. */
export const POST = caseworkApi
  .use(params(questionParamsSchema))
  .use(body(answerSchema))
  .use(withDesk({ create: false }))
  .handle(
    ({ services, desk, path, body }): Promise<AnswerResponse> =>
      services.runs.answer(desk, path.questionId, body),
  );
