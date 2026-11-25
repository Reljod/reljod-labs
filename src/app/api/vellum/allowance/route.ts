import { requireAccess } from "@/features/access/server/gate";
import type { Allowance } from "@/features/vellum/domain/api";
import { LIMITS } from "@/features/vellum/domain/limits";
import { env } from "@/features/vellum/server/env";
import { passesUsed, visitor } from "@/features/vellum/server/rate";
import { failure, json } from "@/features/vellum/server/respond";

/** How many Passes the visitor has left this hour, and which model draws. */
export async function GET() {
  try {
    const [, who] = await Promise.all([requireAccess(), visitor()]);
    const used = await passesUsed(who);
    return json<Allowance>({
      used,
      perHour: LIMITS.passesPerHour,
      model: env.model(),
    });
  } catch (error) {
    return failure(error);
  }
}
