import type { PipelineSpec } from "../pipeline";
import type { Member, MemberRequestKind } from "../records";
import type { DocumentType } from "./documents";

/**
 * Handling a Member request: read the papers, find the Member, check the
 * Rules, decide in code, draft the letter or instruction, wait for a person,
 * record it.
 */
export const MEMBER_REQUEST: PipelineSpec = {
  id: "member_request",
  title: "Member request",
  summary:
    "Reads a Member's request papers, finds the Member, checks identity, eligibility, papers and time limits, then drafts a letter or a payment or transfer instruction for a person to approve.",
  inputSchema: [
    {
      name: "sourceIds",
      type: "id",
      multiple: true,
      required: true,
      description:
        "The request papers: ids of Sources attached in this Session (one or more).",
    },
    {
      name: "memberNo",
      type: "string",
      required: false,
      description:
        "The Member's number (HB-10001), when known. Otherwise it is read from the papers.",
    },
    {
      name: "note",
      type: "string",
      required: false,
      description:
        "Anything the Staff member wants the Draft to take into account.",
    },
  ],
  steps: [
    {
      id: "intake",
      title: "Intake",
      kind: "code",
      after: [],
      summary: "Loads the attached papers and dates the request.",
    },
    {
      id: "classify",
      title: "Classify",
      kind: "model",
      after: ["intake"],
      summary:
        "Says which kind of Member request it is: transfer, leaving Cayman, property, retirement or death.",
    },
    {
      id: "read_documents",
      title: "Read the papers",
      kind: "model",
      after: ["intake"],
      summary:
        "Reads each paper at the same time: which papers are there, the Member's details and the amounts asked for.",
    },
    {
      id: "find_member",
      title: "Find the Member",
      kind: "code",
      after: ["intake"],
      summary: "Matches the papers to a Member record by number or by name.",
    },
    {
      id: "check_identity",
      title: "Check identity",
      kind: "code",
      after: ["find_member", "read_documents"],
      summary: "Compares the papers with the Member record.",
    },
    {
      id: "check_eligibility",
      title: "Check eligibility",
      kind: "code",
      after: ["find_member", "classify", "read_documents"],
      summary:
        "Applies the Rules for this kind of request: time away, contributions, age, caps.",
    },
    {
      id: "check_documents",
      title: "Check the papers",
      kind: "code",
      after: ["classify", "read_documents"],
      summary:
        "Lists the papers this kind of request needs and what is missing.",
    },
    {
      id: "check_deadline",
      title: "Check time limits",
      kind: "code",
      after: ["intake", "classify"],
      summary:
        "Counts the statutory time limit from the date the request arrived.",
    },
    {
      id: "decide",
      title: "Decide",
      kind: "code",
      after: [
        "check_identity",
        "check_eligibility",
        "check_documents",
        "check_deadline",
      ],
      summary:
        "Combines the Findings: any block rejects, any refer asks for papers or a look, otherwise it proceeds.",
    },
    {
      id: "draft",
      title: "Draft",
      kind: "model",
      after: ["decide"],
      summary:
        "Writes the letter or instruction from the Findings; the amounts come from code.",
    },
    {
      id: "approval",
      title: "Approval",
      kind: "approval",
      after: ["draft"],
      risk: "high",
      summary:
        "A person approves the Draft. A letter asking for papers is low risk; a rejection or a payment or transfer instruction is high risk.",
    },
    {
      id: "record",
      title: "Record",
      kind: "code",
      after: ["approval"],
      summary: "Writes the Member request and its status.",
    },
  ],
  skillId: "member-request",
  rulebookSkillId: "member-request-rules",
};

export type PropertyPurpose = "deposit" | "reduction" | "payoff";

/** One Source as `intake` loaded it. */
export type IntakeSource = {
  id: string;
  title: string;
  kind: string;
  /** The date it was attached: the request's received date is the earliest. */
  addedOn: string;
  /** The text, cut to what a model is given. */
  text: string;
  chars: number;
};

/** One paper found inside a Source. */
export type PaperFound = {
  type: DocumentType;
  title: string;
  /** Whether it is signed, when the paper says. */
  signed: boolean | null;
};

/** What `read_documents` found in one Source. */
export type DocumentReading = {
  sourceId: string;
  sourceTitle: string;
  papers: PaperFound[];
  memberNo: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
  /** The kind the papers themselves name, if any. */
  requestKind: MemberRequestKind | null;
  requestedAmountKyd: number | null;
  propertyPurpose: PropertyPurpose | null;
  /** The Member asks for cash rather than a transfer. */
  asksCashRefund: boolean;
  receivingPlan: string | null;
  dateOfDeath: string | null;
  /** Read by the deterministic fallback, not the model. */
  fallback: boolean;
};

/** Everything the member request checks look at. */
export type MemberRequestFacts = {
  /** The date the Run applies the Rules on. */
  asOf: string;
  receivedOn: string;
  kind: MemberRequestKind | null;
  member: Member | null;
  readings: DocumentReading[];
};

const first = <T>(values: (T | null | undefined)[]): T | null =>
  values.find((value) => value !== null && value !== undefined) ?? null;

/** What the papers say about who is asking, first answer wins. */
export function claimedIdentity(readings: DocumentReading[]) {
  return {
    memberNo: first(readings.map((reading) => reading.memberNo)),
    fullName: first(readings.map((reading) => reading.fullName)),
    dateOfBirth: first(readings.map((reading) => reading.dateOfBirth)),
  };
}

export function requestedAmount(readings: DocumentReading[]): number | null {
  return first(readings.map((reading) => reading.requestedAmountKyd));
}

export function propertyPurposeOf(
  readings: DocumentReading[],
): PropertyPurpose | null {
  return first(readings.map((reading) => reading.propertyPurpose));
}

export function papersPresent(readings: DocumentReading[]): Set<DocumentType> {
  return new Set(
    readings.flatMap((reading) => reading.papers.map((paper) => paper.type)),
  );
}

/** Member numbers look like `HB-10001`. */
export const MEMBER_NO = /\bHB-\d{5}\b/i;

export function normaliseMemberNo(value: string): string {
  return value.trim().toUpperCase();
}
