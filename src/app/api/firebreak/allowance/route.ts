import { requireAccess } from "@/features/access/server/gate";
import type { Allowance } from "@/features/firebreak/domain/api";
import { LIMITS } from "@/features/firebreak/domain/limits";
import { env } from "@/features/firebreak/server/env";
import { turnsUsed, visitor } from "@/features/firebreak/server/rate";
import { failure, json } from "@/features/firebreak/server/respond";

/** How many Rounds the visitor has left this hour, and which model sits in the Room. */
export async function GET() {
  try {
    const [, who] = await Promise.all([requireAccess(), visitor()]);
    const used = await turnsUsed(who);
    return json<Allowance>({
      used,
      perHour: LIMITS.turnsPerHour,
      model: env.model(),
    });
  } catch (error) {
    return failure(error);
  }
}
