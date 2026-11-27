import { caseworkApi, rememberDesk } from "@/features/casework/server/api";
import { json } from "@/platform/http/respond";

/** A fresh Desk, opened; the old ones stay on the list to go back to. */
export const POST = caseworkApi.handle(
  async ({ services, owner, visitor, rememberedId }) => {
    const view = await services.desks.create({ owner, visitor });
    return rememberDesk(
      json(view, { status: 201 }),
      view.sessionId,
      rememberedId,
    );
  },
);
