import {
  type RulesResponse,
  ruleEditsSchema,
} from "@/features/canvas/domain/api";
import { canvasApi } from "@/features/canvas/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's Rulebook now, and its saved Versions. */
export const GET = canvasApi.handle(
  ({ services, owner }): Promise<RulesResponse> => services.rules.read(owner),
);

/**
 * Saves Rule edits as a new Version of the Owner's Rulebook and answers the
 * Rules as they now are. A bad value is a 400 with `errors`, one per field.
 */
export const POST = canvasApi
  .use(body(ruleEditsSchema))
  .handle(async ({ services, caller, body }): Promise<RulesResponse> => {
    const { changed: _changed, ...rules } = await services.rules.save(
      caller,
      body.edits,
    );
    return rules;
  });
