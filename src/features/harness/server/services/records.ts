import "server-only";
import { NotFoundError } from "@/platform/errors";
import type {
  EmployerResponse,
  MemberRequestListResponse,
  MemberResponse,
} from "../../domain/api";
import type {
  Employer,
  Member,
  MemberRequestKind,
  MemberRequestStatus,
  Schedule,
} from "../../domain/records";
import type { Actor } from "../ports";
import type * as records from "../records";

/** The desk's records (Employers, Members, Schedules, Member requests): reads only, scoped to the Owner. */
export interface RecordService {
  members(
    actor: Actor,
    filter: { q?: string; employerId?: string | null; limit?: number },
  ): Promise<Member[]>;
  member(actor: Actor, idOrMemberNo: string): Promise<MemberResponse>;
  employers(actor: Actor): Promise<Employer[]>;
  employer(actor: Actor, idOrCode: string): Promise<EmployerResponse>;
  schedules(
    actor: Actor,
    filter: { employerId?: string | null; period?: string | null },
  ): Promise<Schedule[]>;
  memberRequests(
    actor: Actor,
    filter: {
      kind?: MemberRequestKind | null;
      memberId?: string | null;
      status?: MemberRequestStatus | null;
    },
  ): Promise<MemberRequestListResponse["requests"]>;
}

export type RecordRepository = Pick<
  typeof records,
  | "findMembers"
  | "getMember"
  | "listEmployers"
  | "getEmployer"
  | "listSchedules"
  | "listMemberRequests"
>;

export function createRecordService(ports: {
  records: RecordRepository;
}): RecordService {
  const { records } = ports;
  return {
    members: (actor, filter) => records.findMembers(actor.owner, filter),
    async member(actor, idOrMemberNo) {
      const found = await records.getMember(actor.owner, idOrMemberNo);
      if (!found)
        throw new NotFoundError("That Member is not in this Workspace.");
      return found;
    },
    employers: (actor) => records.listEmployers(actor.owner),
    async employer(actor, idOrCode) {
      const found = await records.getEmployer(actor.owner, idOrCode);
      if (!found)
        throw new NotFoundError("That Employer is not in this Workspace.");
      return found;
    },
    schedules: (actor, filter) => records.listSchedules(actor.owner, filter),
    memberRequests: (actor, filter) =>
      records.listMemberRequests(actor.owner, filter),
  };
}
