import {
  type DeskStatusResponse,
  openDeskSchema,
} from "@/features/casework/domain/api";
import { caseworkApi, rememberDesk } from "@/features/casework/server/api";
import { body } from "@/platform/http/middleware";
import { json } from "@/platform/http/respond";

/**
 * The open Desk's Runs, the Owner's list of Desks and the Spend, for
 * refreshing the desk; 404 before the Owner has a Desk.
 */
export const GET = caseworkApi.handle(
  ({ services, owner, rememberedId }): Promise<DeskStatusResponse> =>
    services.desks.status(owner, rememberedId),
);

/**
 * Opens a Desk with everything it shows (the Cabinet, the chat so far, Runs,
 * Spend, settings): the earlier Desk asked for (404 when it is not the
 * Owner's), or the current one, created on first use. The browser then
 * remembers it as its open Desk.
 */
export const PUT = caseworkApi
  .use(body(openDeskSchema))
  .handle(async ({ services, owner, visitor, rememberedId, body, request }) => {
    const view = await services.desks.open(
      { owner, visitor },
      rememberedId,
      body.deskId ?? null,
    );
    return rememberDesk(json(view, { request }), view.sessionId, rememberedId);
  });
