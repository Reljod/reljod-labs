import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  EmployerResponse,
  MemberRequestListResponse,
  MemberResponse,
} from "../domain/api";
import type {
  Employer,
  EmployerStatus,
  Member,
  MemberRequest,
  MemberRequestKind,
  MemberRequestStatus,
  MemberStatus,
  Schedule,
  ScheduleStatus,
} from "../domain/records";
import { type Db, isUuid, sql } from "./db";

/*
 * Read-only lookups of the plan's records, each scoped to the Owner. The
 * routes under `/api/harness/records`, the Pipelines' own Steps and the MCP
 * server's record tools call these. Dates are selected as text (`::text`)
 * so they stay `YYYY-MM-DD` whatever the driver does with `date`.
 */

const LIST_LIMIT = 200;

const money = (value: string | number | null) =>
  value === null ? 0 : Number(value);

type EmployerRow = {
  id: string;
  code: string;
  name: string;
  status: EmployerStatus;
  joined_on: string | null;
  contact_email: string | null;
};

export const employerOf = (row: EmployerRow): Employer => ({
  id: row.id,
  code: row.code,
  name: row.name,
  status: row.status,
  joinedOn: row.joined_on,
  contactEmail: row.contact_email,
});

type MemberRow = {
  id: string;
  employer_id: string | null;
  member_no: string;
  full_name: string;
  date_of_birth: string | null;
  nationality: string | null;
  caymanian: boolean;
  residency_status: string | null;
  left_cayman_on: string | null;
  employment_ended_on: string | null;
  last_contribution_on: string | null;
  balance_kyd: string;
  vested: boolean;
  email: string | null;
  address: string | null;
  status: MemberStatus;
};

export const memberOf = (row: MemberRow): Member => ({
  id: row.id,
  employerId: row.employer_id,
  memberNo: row.member_no,
  fullName: row.full_name,
  dateOfBirth: row.date_of_birth,
  nationality: row.nationality,
  caymanian: row.caymanian,
  residencyStatus: row.residency_status,
  leftCaymanOn: row.left_cayman_on,
  employmentEndedOn: row.employment_ended_on,
  lastContributionOn: row.last_contribution_on,
  balanceKyd: money(row.balance_kyd),
  vested: row.vested,
  email: row.email,
  address: row.address,
  status: row.status,
});

/** The columns `memberOf` reads, dates as text. */
export const MEMBER_COLUMNS = `
  m.id, m.employer_id, m.member_no, m.full_name,
  m.date_of_birth::text as date_of_birth, m.nationality, m.caymanian,
  m.residency_status, m.left_cayman_on::text as left_cayman_on,
  m.employment_ended_on::text as employment_ended_on,
  m.last_contribution_on::text as last_contribution_on,
  m.balance_kyd, m.vested, m.email, m.address, m.status`;

type RequestRow = {
  id: string;
  member_id: string;
  kind: MemberRequestKind;
  received_on: string;
  status: MemberRequestStatus;
  amount_kyd: string | null;
  details: Record<string, unknown>;
  run_id: string | null;
};

const requestOf = (row: RequestRow): MemberRequest => ({
  id: row.id,
  memberId: row.member_id,
  kind: row.kind,
  receivedOn: row.received_on,
  status: row.status,
  amountKyd: row.amount_kyd === null ? null : Number(row.amount_kyd),
  details: row.details ?? {},
  runId: row.run_id,
});

/** Escapes `%`, `_` and `\` for a LIKE pattern. */
const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

const clampLimit = (limit: number | undefined, fallback: number) =>
  Math.max(1, Math.min(Math.trunc(limit ?? fallback) || fallback, LIST_LIMIT));

/** Members whose name or number matches `q` (all of them, up to `limit`, when it is empty). */
export async function findMembers(
  owner: Owner,
  filter: { q?: string; employerId?: string | null; limit?: number } = {},
): Promise<Member[]> {
  const db = sql();
  const q = filter.q?.trim().slice(0, 80) ?? "";
  if (filter.employerId && !isUuid(filter.employerId)) return [];
  const rows = await db.unsafe<MemberRow[]>(
    `select ${MEMBER_COLUMNS}
     from harness.members m
     where m.owner = $1
       and ($2 = '' or m.full_name ilike $3 or m.member_no ilike $3)
       and ($4::uuid is null or m.employer_id = $4::uuid)
     order by m.full_name
     limit $5`,
    [
      owner,
      q,
      likeOf(q),
      filter.employerId ?? null,
      clampLimit(filter.limit, 50),
    ],
  );
  return rows.map(memberOf);
}

/** A Member by id or number, scoped to the Owner; null when there is none. */
export async function memberByIdOrNo(
  db: Db,
  owner: Owner,
  idOrMemberNo: string,
): Promise<Member | null> {
  const key = idOrMemberNo.trim();
  if (!key) return null;
  const byId = isUuid(key);
  const [row] = await db.unsafe<MemberRow[]>(
    `select ${MEMBER_COLUMNS}
     from harness.members m
     where m.owner = $1 and ${byId ? "m.id = $2::uuid" : "upper(m.member_no) = upper($2)"}
     limit 1`,
    [owner, key],
  );
  return row ? memberOf(row) : null;
}

/** A Member by id or by member number, with their Employer and Member requests; null when not in the Workspace. */
export async function getMember(
  owner: Owner,
  idOrMemberNo: string,
): Promise<MemberResponse | null> {
  const db = sql();
  const member = await memberByIdOrNo(db, owner, idOrMemberNo);
  if (!member) return null;
  const [employers, requests] = await Promise.all([
    member.employerId
      ? db<EmployerRow[]>`
          select id, code, name, status, joined_on::text as joined_on, contact_email
          from harness.employers
          where owner = ${owner} and id = ${member.employerId}`
      : Promise.resolve([] as EmployerRow[]),
    db<RequestRow[]>`
      select id, member_id, kind, received_on::text as received_on, status,
             amount_kyd, details, run_id
      from harness.member_requests
      where owner = ${owner} and member_id = ${member.id}
      order by received_on desc, id`,
  ]);
  const [employer] = employers;
  return {
    member,
    employer: employer ? employerOf(employer) : null,
    requests: requests.map(requestOf),
  };
}

/** The plan's Employers, by name. */
export async function listEmployers(owner: Owner): Promise<Employer[]> {
  const rows = await sql()<EmployerRow[]>`
    select id, code, name, status, joined_on::text as joined_on, contact_email
    from harness.employers
    where owner = ${owner}
    order by name`;
  return rows.map(employerOf);
}

/** An Employer by id or code, scoped to the Owner. */
export async function employerByIdOrCode(
  db: Db,
  owner: Owner,
  idOrCode: string,
): Promise<Employer | null> {
  const key = idOrCode.trim();
  if (!key) return null;
  const [row] = isUuid(key)
    ? await db<EmployerRow[]>`
        select id, code, name, status, joined_on::text as joined_on, contact_email
        from harness.employers where owner = ${owner} and id = ${key}`
    : await db<EmployerRow[]>`
        select id, code, name, status, joined_on::text as joined_on, contact_email
        from harness.employers where owner = ${owner} and upper(code) = upper(${key})`;
  return row ? employerOf(row) : null;
}

/** An Employer by id or by code, with its Schedules (lines included); null when not in the Workspace. */
export async function getEmployer(
  owner: Owner,
  idOrCode: string,
): Promise<EmployerResponse | null> {
  const employer = await employerByIdOrCode(sql(), owner, idOrCode);
  if (!employer) return null;
  return {
    employer,
    schedules: await listSchedules(owner, { employerId: employer.id }),
  };
}

type ScheduleRow = {
  id: string;
  employer_id: string;
  period: string;
  source_id: string | null;
  received_on: string | null;
  status: ScheduleStatus;
};

type LineRow = {
  id: string;
  schedule_id: string;
  member_no: string;
  member_name: string;
  earnings_kyd: string;
  employee_kyd: string;
  employer_kyd: string;
  voluntary_kyd: string;
};

/** Schedules with their lines, newest month first. `period` is the month's first day (`YYYY-MM-01`). */
export async function listSchedules(
  owner: Owner,
  filter: { employerId?: string | null; period?: string | null } = {},
): Promise<Schedule[]> {
  const db = sql();
  if (filter.employerId && !isUuid(filter.employerId)) return [];
  const period =
    filter.period && /^\d{4}-\d{2}(-01)?$/.test(filter.period)
      ? `${filter.period.slice(0, 7)}-01`
      : null;
  const schedules = await db<ScheduleRow[]>`
    select id, employer_id, period::text as period, source_id,
           received_on::text as received_on, status
    from harness.schedules
    where owner = ${owner}
      ${filter.employerId ? db`and employer_id = ${filter.employerId}` : db``}
      ${period ? db`and period = ${period}` : db``}
    order by period desc, employer_id
    limit ${LIST_LIMIT}`;
  if (schedules.length === 0) return [];
  const lines = await db<LineRow[]>`
    select id, schedule_id, member_no, member_name, earnings_kyd,
           employee_kyd, employer_kyd, voluntary_kyd
    from harness.schedule_lines
    where owner = ${owner}
      and schedule_id in ${db(schedules.map((schedule) => schedule.id))}
    order by member_no, id`;
  const bySchedule = new Map<string, Schedule["lines"]>();
  for (const line of lines) {
    const list = bySchedule.get(line.schedule_id) ?? [];
    list.push({
      id: line.id,
      memberNo: line.member_no,
      memberName: line.member_name,
      earningsKyd: Number(line.earnings_kyd),
      employeeKyd: Number(line.employee_kyd),
      employerKyd: Number(line.employer_kyd),
      voluntaryKyd: Number(line.voluntary_kyd),
    });
    bySchedule.set(line.schedule_id, list);
  }
  return schedules.map((schedule) => ({
    id: schedule.id,
    employerId: schedule.employer_id,
    period: schedule.period,
    sourceId: schedule.source_id,
    receivedOn: schedule.received_on,
    status: schedule.status,
    lines: bySchedule.get(schedule.id) ?? [],
  }));
}

/** Member requests, newest first, each with its Member's number and name. */
export async function listMemberRequests(
  owner: Owner,
  filter: {
    kind?: MemberRequestKind | null;
    memberId?: string | null;
    status?: MemberRequestStatus | null;
  } = {},
): Promise<MemberRequestListResponse["requests"]> {
  const db = sql();
  if (filter.memberId && !isUuid(filter.memberId)) return [];
  const rows = await db<
    (RequestRow & { member_no: string; full_name: string })[]
  >`
    select r.id, r.member_id, r.kind, r.received_on::text as received_on,
           r.status, r.amount_kyd, r.details, r.run_id,
           m.member_no, m.full_name
    from harness.member_requests r
    join harness.members m on m.id = r.member_id and m.owner = r.owner
    where r.owner = ${owner}
      ${filter.kind ? db`and r.kind = ${filter.kind}` : db``}
      ${filter.memberId ? db`and r.member_id = ${filter.memberId}` : db``}
      ${filter.status ? db`and r.status = ${filter.status}` : db``}
    order by r.received_on desc, r.id
    limit ${LIST_LIMIT}`;
  return rows.map((row) => ({
    ...requestOf(row),
    member: { memberNo: row.member_no, fullName: row.full_name },
  }));
}
