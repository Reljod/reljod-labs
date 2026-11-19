import type { RulesResponse } from "@/features/canvas/domain/api";
import { requireCaller } from "@/features/canvas/server/caller";
import { failure, json } from "@/features/canvas/server/respond";
import {
  currentRulebook,
  rulebookHistory,
} from "@/features/canvas/server/rules";

/** The Owner's Rulebook now, and its saved Versions. */
export async function GET() {
  try {
    const caller = await requireCaller();
    const [current, history] = await Promise.all([
      currentRulebook(caller.owner),
      rulebookHistory(caller.owner),
    ]);
    return json<RulesResponse>({
      version: current.version,
      rulebook: current.rulebook,
      savedAt: current.savedAt,
      history,
    });
  } catch (error) {
    return failure(error);
  }
}
