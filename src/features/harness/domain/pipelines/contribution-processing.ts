import type { PipelineSpec } from "../pipeline";
import type { MemberStatus } from "../records";
import type { ScheduleLineIn } from "./schedule";

/**
 * Processing an Employer's monthly Schedule: read the lines, check each
 * against the Members, the rates, the cap and coverage, match the money
 * received, then post it or hold it with a query to the Employer.
 */
export const CONTRIBUTION_PROCESSING: PipelineSpec = {
  id: "contribution_processing",
  title: "Contribution processing",
  summary:
    "Reads an Employer's Schedule (CSV or XLSX), checks every line against the Members, the rates, the earnings cap and coverage, matches the money received, and posts it or holds it with a query to the Employer.",
  inputSchema: [
    {
      name: "sourceId",
      type: "id",
      required: true,
      description:
        "The Schedule: the id of a CSV or XLSX Source attached in this Session.",
    },
    {
      name: "employerCode",
      type: "string",
      required: false,
      description: "The Employer's code (ER-1001), when the file does not say.",
    },
    {
      name: "period",
      type: "month",
      required: false,
      description:
        "The contribution month (YYYY-MM). When the file does not say, last month.",
    },
    {
      name: "overrideExceptions",
      type: "boolean",
      required: false,
      description:
        "Post the Schedule even with exceptions. Makes the Approval high risk.",
    },
  ],
  steps: [
    {
      id: "parse_schedule",
      title: "Read the Schedule",
      kind: "code",
      after: [],
      summary:
        "Reads the lines from the CSV or XLSX and finds the Employer and month.",
    },
    {
      id: "match_members",
      title: "Match Members",
      kind: "code",
      after: ["parse_schedule"],
      summary: "Finds unknown Members, leavers and lines listed twice.",
    },
    {
      id: "check_rates",
      title: "Check rates",
      kind: "code",
      after: ["parse_schedule"],
      summary: "Employer at least 5%, employee at most 5%, 10% in all.",
    },
    {
      id: "check_cap",
      title: "Check the cap",
      kind: "code",
      after: ["parse_schedule"],
      summary: "Earnings over the yearly maximum are not pensionable.",
    },
    {
      id: "check_coverage",
      title: "Check coverage",
      kind: "code",
      after: ["parse_schedule"],
      summary: "Age 18 to 65, and the nine-month wait for non-Caymanians.",
    },
    {
      id: "match_remittance",
      title: "Match the money",
      kind: "code",
      after: ["parse_schedule"],
      summary:
        "Compares the Schedule's total with the money received and when it came.",
    },
    {
      id: "reconcile",
      title: "Reconcile",
      kind: "code",
      after: [
        "match_members",
        "check_rates",
        "check_cap",
        "check_coverage",
        "match_remittance",
      ],
      summary:
        "Builds the exceptions table and the totals, and decides post or hold.",
    },
    {
      id: "draft_query",
      title: "Draft the query",
      kind: "model",
      after: ["reconcile"],
      summary:
        "Writes the query to the Employer listing the exceptions, or the posting note.",
    },
    {
      id: "approval",
      title: "Approval",
      kind: "approval",
      after: ["draft_query"],
      risk: "high",
      summary:
        "A person approves. A query or a clean posting is low risk; posting over exceptions is high risk.",
    },
    {
      id: "post",
      title: "Post",
      kind: "code",
      after: ["approval"],
      summary: "Marks the Schedule posted (reconciled) or held (queried).",
    },
  ],
  skillId: "contribution-processing",
  rulebookSkillId: "contribution-processing-rules",
};

/** What the contribution checks know about a Member named on a line. */
export type ScheduleMember = {
  memberNo: string;
  fullName: string;
  employerId: string | null;
  status: MemberStatus;
  employmentEndedOn: string | null;
  dateOfBirth: string | null;
  caymanian: boolean;
  residencyStatus: string | null;
  /** The day the Member started work in the Islands, when known. */
  startedWorkOn: string | null;
};

export type MatchFacts = {
  period: string;
  employerId: string | null;
  lines: ScheduleLineIn[];
  members: Record<string, ScheduleMember>;
};

export type RateFacts = {
  lines: ScheduleLineIn[];
  /** The yearly cap the Run applies (`cp.ympe-cap`), so rates use pensionable earnings. */
  annualCapKyd: number;
};

export type CapFacts = {
  lines: ScheduleLineIn[];
  /** The total rate the Run applies (`cp.total-rate`), to know what is mandatory. */
  totalRatePct: number;
};

export type CoverageFacts = {
  period: string;
  lines: ScheduleLineIn[];
  members: Record<string, ScheduleMember>;
};

export type RemittanceIn = {
  amountKyd: number;
  receivedOn: string;
  reference: string | null;
};

export type RemittanceFacts = {
  period: string;
  asOf: string;
  scheduleTotalKyd: number;
  remittances: RemittanceIn[];
};

/** One line the Run found a problem with, as the checks report it in `compared.lines`. */
export type LineProblem = {
  line: number | null;
  memberNo: string | null;
  memberName: string | null;
  detail: string;
};
