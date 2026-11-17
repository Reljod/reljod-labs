/** The plan's records a Pipeline reads. Amounts are Cayman Islands dollars (KYD). */

export type EmployerStatus = "active" | "delinquent" | "suspended" | "closed";

/** A company in the pension plan that remits contributions for its Members each month. */
export type Employer = {
  id: string;
  code: string;
  name: string;
  status: EmployerStatus;
  joinedOn: string | null;
  contactEmail: string | null;
};

export type MemberStatus =
  | "active"
  | "inactive"
  | "deferred"
  | "retired"
  | "deceased"
  | "closed";

/** A person with a pension account in the plan. Not a Staff member. */
export type Member = {
  id: string;
  employerId: string | null;
  memberNo: string;
  fullName: string;
  /** ISO dates (`YYYY-MM-DD`) throughout. */
  dateOfBirth: string | null;
  nationality: string | null;
  caymanian: boolean;
  residencyStatus: string | null;
  leftCaymanOn: string | null;
  employmentEndedOn: string | null;
  lastContributionOn: string | null;
  balanceKyd: number;
  vested: boolean;
  email: string | null;
  address: string | null;
  status: MemberStatus;
};

export type ScheduleStatus =
  | "received"
  | "processing"
  | "reconciled"
  | "queried"
  | "rejected";

/** An Employer's monthly file of contribution lines, one per Member. */
export type Schedule = {
  id: string;
  employerId: string;
  /** The contribution month, as its first day. */
  period: string;
  /** The Source it was read from, if it came by upload. */
  sourceId: string | null;
  receivedOn: string | null;
  status: ScheduleStatus;
  lines: ScheduleLine[];
};

export type ScheduleLine = {
  id: string;
  memberNo: string;
  memberName: string;
  earningsKyd: number;
  employeeKyd: number;
  employerKyd: number;
  voluntaryKyd: number;
};

/** The money an Employer paid for one month, to be matched to its Schedule. */
export type Remittance = {
  id: string;
  employerId: string;
  period: string;
  amountKyd: number;
  receivedOn: string;
  reference: string | null;
};

export const MEMBER_REQUEST_KINDS = [
  "transfer_out",
  "cessation_of_residence",
  "property",
  "retirement",
  "death",
] as const;

export type MemberRequestKind = (typeof MEMBER_REQUEST_KINDS)[number];

export const MEMBER_REQUEST_LABEL: Record<MemberRequestKind, string> = {
  transfer_out: "Transfer out",
  cessation_of_residence: "Leaving Cayman",
  property: "Withdrawal for property",
  retirement: "Retirement",
  death: "Claim on death",
};

export type MemberRequestStatus =
  | "received"
  | "in_review"
  | "approved"
  | "returned"
  | "paid"
  | "closed";

/** What a Member asks the plan to do. */
export type MemberRequest = {
  id: string;
  memberId: string;
  kind: MemberRequestKind;
  receivedOn: string;
  status: MemberRequestStatus;
  amountKyd: number | null;
  details: Record<string, unknown>;
  /** The latest Run that handled it. */
  runId: string | null;
};
