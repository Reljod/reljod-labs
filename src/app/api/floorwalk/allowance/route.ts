import { requireAccess } from "@/features/access/server/gate";
import type { Allowance } from "@/features/floorwalk/domain/api";
import { LIMITS } from "@/features/floorwalk/domain/limits";
import { env } from "@/features/floorwalk/server/env";
import { used, visitor } from "@/features/floorwalk/server/rate";
import { failure, json } from "@/features/floorwalk/server/respond";

/** How many Walks and questions the visitor has left this hour. */
export async function GET() {
  try {
    const [, who] = await Promise.all([requireAccess(), visitor()]);
    const count = await used(who);
    return json<Allowance>({
      walksUsed: count.walks,
      walksPerHour: LIMITS.walksPerHour,
      asksUsed: count.asks,
      asksPerHour: LIMITS.asksPerHour,
      model: env.model(),
    });
  } catch (error) {
    return failure(error);
  }
}
