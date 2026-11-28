import { askRequestSchema } from "@/features/floorwalk/domain/api";
import { floorwalkApi } from "@/features/floorwalk/server/api";
import { body } from "@/platform/http/middleware";

export const maxDuration = 120;

/** Ask the footage a question; the answer comes with moments to jump to. */
export const POST = floorwalkApi
  .use(body(askRequestSchema))
  .handle(({ services, owner, visitor, body, request }) =>
    services.ask({ owner, visitor }, body.source, body.question, {
      origin: new URL(request.url).origin,
      signal: request.signal,
    }),
  );
