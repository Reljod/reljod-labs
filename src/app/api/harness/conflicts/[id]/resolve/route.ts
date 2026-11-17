import { z } from "zod";
import type { ConflictResponse } from "@/features/harness/domain/api";
import { RESOLUTIONS } from "@/features/harness/domain/knowledge";
import { requirePermission } from "@/features/harness/server/context";
import { resolveConflict } from "@/features/harness/server/knowledge";
import { bodyOf, failure, json } from "@/features/harness/server/respond";

type Context = RouteContext<"/api/harness/conflicts/[id]/resolve">;

const schema = z.object({ resolution: z.enum(RESOLUTIONS) });

/** Settles a Conflict (admin): supersede, keep both or set aside. Settling twice is a 409. */
export async function POST(request: Request, { params }: Context) {
  try {
    const context = await requirePermission("conflict.resolve");
    const { id } = await params;
    const { resolution } = schema.parse(await bodyOf(request));
    return json<ConflictResponse>({
      conflict: await resolveConflict({
        ...context,
        conflictId: id,
        resolution,
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
