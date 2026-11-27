import {
  type PassEvent,
  passRequestSchema,
} from "@/features/vellum/domain/api";
import { vellumApi } from "@/features/vellum/server/api";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

export const maxDuration = 300;

/**
 * Three images at the largest size (about 2 MB each as base64: screenshot,
 * squared, rendering) with the last Drawing beside them. The schema bounds
 * each image again.
 */
const PASS_BODY_LIMIT = 8 * 1024 * 1024;

/**
 * One Pass: the Draftsman draws, and its marks stream back as NDJSON as they
 * complete. The gate, the request's shape, every image and the rate are all
 * checked before the model is called; after that, a failure is an `error`
 * line in the stream.
 */
export const POST = vellumApi
  .use(body(passRequestSchema, { limit: PASS_BODY_LIMIT }))
  .handle(async ({ services, visitor, body, request }) =>
    ndjson<PassEvent>(await services.pass(visitor, body, request.signal), {
      scope: "vellum",
      signal: request.signal,
      onError: () => ({
        t: "error",
        message: "The Draftsman stopped partway. Try another Pass.",
      }),
    }),
  );
