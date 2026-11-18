import { requireOwner } from "@/features/access/server/gate";
import type { RuleVersionsResponse } from "@/features/document-compliance/domain/api";
import { isRuleId } from "@/features/document-compliance/domain/rules";
import {
  failure,
  json,
  NotFoundError,
} from "@/features/document-compliance/server/respond";
import { listRuleVersions } from "@/features/document-compliance/server/rules";

/** One Rule's saved Versions for this Owner, newest first, then its Default. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/document-compliance/rules/[ruleId]/versions">,
) {
  try {
    const { owner } = await requireOwner();
    const { ruleId } = await params;
    if (!isRuleId(ruleId)) throw new NotFoundError("No such Rule.");
    return json<RuleVersionsResponse>(await listRuleVersions(owner, ruleId));
  } catch (error) {
    return failure(error);
  }
}
