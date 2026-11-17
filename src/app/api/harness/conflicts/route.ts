import { z } from "zod";
import type { ConflictListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { listConflicts } from "@/features/harness/server/knowledge";
import { failure, json } from "@/features/harness/server/respond";

const schema = z.object({
  status: z.enum(["open", "resolved"]).nullish(),
});

/** The Workspace's Conflicts, open first. `?status=open` or `resolved` narrows them. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireStaff();
    const { status } = schema.parse({
      status: new URL(request.url).searchParams.get("status") ?? undefined,
    });
    return json<ConflictListResponse>({
      conflicts: await listConflicts(owner, { status }),
    });
  } catch (error) {
    return failure(error);
  }
}
