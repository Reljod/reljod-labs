import type { MemberRequestListResponse } from "@/features/harness/domain/api";
import {
  MEMBER_REQUEST_KINDS,
  type MemberRequestKind,
} from "@/features/harness/domain/records";
import { requireStaff } from "@/features/harness/server/context";
import { listMemberRequests } from "@/features/harness/server/records";
import { failure, json } from "@/features/harness/server/respond";

const isKind = (value: string | null): value is MemberRequestKind =>
  value !== null && (MEMBER_REQUEST_KINDS as readonly string[]).includes(value);

/** Member requests, newest first; `?kind=` and `?member=` narrow them. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireStaff();
    const search = new URL(request.url).searchParams;
    const kind = search.get("kind");
    return json<MemberRequestListResponse>({
      requests: await listMemberRequests(owner, {
        kind: isKind(kind) ? kind : null,
        memberId: search.get("member"),
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
