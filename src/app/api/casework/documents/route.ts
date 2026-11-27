import { finishUploadsSchema } from "@/features/casework/domain/api";
import { caseworkApi, withDesk } from "@/features/casework/server/api";
import type { DocView } from "@/features/casework/view";
import { body } from "@/platform/http/middleware";

/**
 * Records finished uploads as Documents of the open Desk, from their tickets:
 * what Storage really holds, each ticket once. Answers the new Documents.
 */
export const POST = caseworkApi
  .use(body(finishUploadsSchema))
  .use(withDesk({ create: true }))
  .handle(
    ({ services, desk, body }): Promise<DocView[]> =>
      services.uploads.finish(desk, body.tickets),
  );
