import type { RuleHistoryResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { failure, json } from "@/features/harness/server/respond";
import { ruleHistory } from "@/features/harness/server/rules";

type Context = { params: Promise<{ id: string }> };

/** A Rule's saved Versions, newest first. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const context = await requireStaff();
    const { id } = await params;
    return json<RuleHistoryResponse>({
      versions: await ruleHistory(context.owner, id),
    });
  } catch (error) {
    return failure(error);
  }
}
