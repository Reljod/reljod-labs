import type { RuleListResponse } from "@/features/harness/domain/api";
import { isPipelineId } from "@/features/harness/domain/pipeline";
import { requireStaff } from "@/features/harness/server/context";
import { InvalidError } from "@/features/harness/server/errors";
import { failure, json } from "@/features/harness/server/respond";
import { listRules } from "@/features/harness/server/rules";

/** Rules as the Workspace has them; `?pipeline=` for one Rulebook's. */
export async function GET(request: Request) {
  try {
    const context = await requireStaff();
    const pipeline = new URL(request.url).searchParams.get("pipeline");
    if (pipeline && !isPipelineId(pipeline)) {
      throw new InvalidError("There is no such Pipeline.");
    }
    return json<RuleListResponse>({
      rules: await listRules(
        context.owner,
        pipeline && isPipelineId(pipeline) ? pipeline : null,
      ),
    });
  } catch (error) {
    return failure(error);
  }
}
