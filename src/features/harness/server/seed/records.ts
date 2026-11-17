import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { isoOf, periodStart } from "../../domain/pipelines/dates";
import { buildSeedBook } from "../../domain/pipelines/seed-data";
import type { Db } from "../db";

/**
 * Seeds a new Workspace's records: the Employers, Members, Schedules,
 * Remittances and Member requests of the fictional Harbour Bank & Trust
 * pension plan, laid out relative to today (`buildSeedBook`), so the latest
 * month always has its problems in place.
 *
 * Called by `ensureWorkspace` inside the transaction that holds the
 * Workspace's row lock: a handful of multi-row inserts, no model. Like the
 * other seeders it adds only what is missing, whatever seed the Workspace
 * held before, so a raised `SEED_VERSION` tops it up: Employers and Members
 * insert `on conflict do nothing`, and the month-by-month records go in only
 * when the Workspace has none yet (they have no natural key to conflict
 * on). Needs migration
 * `20261117130000_harness_pipelines.sql` (`members.started_work_on`).
 */
export async function seedRecords(tx: Db, owner: Owner): Promise<void> {
  const book = buildSeedBook(isoOf(new Date()));

  await tx`
    insert into harness.employers ${tx(
      book.employers.map((employer) => ({
        owner,
        code: employer.code,
        name: employer.name,
        status: employer.status,
        joined_on: employer.joinedOn,
        contact_email: employer.contactEmail,
      })),
    )}
    on conflict (owner, code) do nothing`;
  const employers = await tx<{ id: string; code: string }[]>`
    select id, code from harness.employers where owner = ${owner}`;
  const employerId = new Map(employers.map((row) => [row.code, row.id]));

  await tx`
    insert into harness.members ${tx(
      book.members.map((member) => ({
        owner,
        employer_id: member.employerCode
          ? (employerId.get(member.employerCode) ?? null)
          : null,
        member_no: member.memberNo,
        full_name: member.fullName,
        date_of_birth: member.dateOfBirth,
        nationality: member.nationality,
        caymanian: member.caymanian,
        residency_status: member.residencyStatus,
        left_cayman_on: member.leftCaymanOn,
        employment_ended_on: member.employmentEndedOn,
        last_contribution_on: member.lastContributionOn,
        started_work_on: member.startedWorkOn,
        balance_kyd: member.balanceKyd,
        vested: member.vested,
        email: member.email,
        address: member.address,
        status: member.status,
      })),
    )}
    on conflict (owner, member_no) do nothing`;

  const [{ count } = { count: 0 }] = await tx<{ count: number }[]>`
    select count(*)::int as count from harness.schedules where owner = ${owner}`;
  if (count > 0) return;

  const schedules = await tx<
    { id: string; employer_id: string; period: string }[]
  >`
    insert into harness.schedules ${tx(
      book.schedules.map((schedule) => ({
        owner,
        employer_id: employerId.get(schedule.employerCode) as string,
        period: periodStart(schedule.period),
        received_on: schedule.receivedOn,
        status: schedule.status,
      })),
    )}
    returning id, employer_id, period::text as period`;
  const scheduleId = new Map(
    schedules.map((row) => [`${row.employer_id}/${row.period}`, row.id]),
  );
  const lines = book.schedules.flatMap((schedule) => {
    const id = scheduleId.get(
      `${employerId.get(schedule.employerCode)}/${periodStart(schedule.period)}`,
    );
    return id
      ? schedule.lines.map((line) => ({
          schedule_id: id,
          owner,
          member_no: line.memberNo,
          member_name: line.memberName,
          earnings_kyd: line.earningsKyd,
          employee_kyd: line.employeeKyd,
          employer_kyd: line.employerKyd,
          voluntary_kyd: line.voluntaryKyd,
        }))
      : [];
  });
  if (lines.length > 0) {
    await tx`insert into harness.schedule_lines ${tx(lines)}`;
  }

  await tx`
    insert into harness.remittances ${tx(
      book.remittances.map((remittance) => ({
        owner,
        employer_id: employerId.get(remittance.employerCode) as string,
        period: periodStart(remittance.period),
        amount_kyd: remittance.amountKyd,
        received_on: remittance.receivedOn,
        reference: remittance.reference,
      })),
    )}`;

  const members = await tx<{ id: string; member_no: string }[]>`
    select id, member_no from harness.members
    where owner = ${owner}
      and member_no in ${tx(book.requests.map((request) => request.memberNo))}`;
  const memberId = new Map(members.map((row) => [row.member_no, row.id]));
  const requests = book.requests.flatMap((request) => {
    const id = memberId.get(request.memberNo);
    return id
      ? [
          {
            owner,
            member_id: id,
            kind: request.kind,
            received_on: request.receivedOn,
            status: request.status,
            amount_kyd: request.amountKyd,
            details: tx.json(request.details as never),
          },
        ]
      : [];
  });
  if (requests.length > 0) {
    await tx`insert into harness.member_requests ${tx(requests)}`;
  }
}
