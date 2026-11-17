import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  EmployerResponse,
  MemberRequestListResponse,
  MemberResponse,
} from "../domain/api";
import type {
  Employer,
  Member,
  MemberRequestKind,
  MemberRequestStatus,
  Schedule,
} from "../domain/records";
import { NotBuiltError } from "./errors";

/*
 * STUB. Owned by the Pipelines slice, which replaces every body here and
 * keeps the signatures. Read-only lookups of the plan's records, each scoped
 * to the Owner. The routes under `/api/harness/records`, the Pipelines' own
 * Steps and the MCP server's record tools call these.
 */

/** Members whose name or number matches `q` (all of them, up to `limit`, when it is empty). */
export async function findMembers(
  _owner: Owner,
  _filter: { q?: string; employerId?: string | null; limit?: number } = {},
): Promise<Member[]> {
  throw new NotBuiltError("pipelines");
}

/** A Member by id or by member number, with their Employer and Member requests; null when not in the Workspace. */
export async function getMember(
  _owner: Owner,
  _idOrMemberNo: string,
): Promise<MemberResponse | null> {
  throw new NotBuiltError("pipelines");
}

/** The plan's Employers, by name. */
export async function listEmployers(_owner: Owner): Promise<Employer[]> {
  throw new NotBuiltError("pipelines");
}

/** An Employer by id or by code, with its Schedules (lines included); null when not in the Workspace. */
export async function getEmployer(
  _owner: Owner,
  _idOrCode: string,
): Promise<EmployerResponse | null> {
  throw new NotBuiltError("pipelines");
}

/** Schedules with their lines, newest month first. `period` is the month's first day (`YYYY-MM-01`). */
export async function listSchedules(
  _owner: Owner,
  _filter: { employerId?: string | null; period?: string | null } = {},
): Promise<Schedule[]> {
  throw new NotBuiltError("pipelines");
}

/** Member requests, newest first, each with its Member's number and name. */
export async function listMemberRequests(
  _owner: Owner,
  _filter: {
    kind?: MemberRequestKind | null;
    memberId?: string | null;
    status?: MemberRequestStatus | null;
  } = {},
): Promise<MemberRequestListResponse["requests"]> {
  throw new NotBuiltError("pipelines");
}
