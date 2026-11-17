import type { MemberRequestKind } from "../records";
import { isIsoDate } from "./dates";
import type { DocumentType } from "./documents";
import {
  type DocumentReading,
  MEMBER_NO,
  normaliseMemberNo,
  type PaperFound,
  type PropertyPurpose,
} from "./member-request";

/*
 * The deterministic fallbacks for the model Steps that read: keyword
 * classification and labelled-field extraction. A Run uses them when the
 * model call fails or is switched off (stubbed e2e runs), so it still
 * finishes; their output is marked `fallback: true`. They only read: like
 * the model, they never make a Finding.
 */

const KIND_PATTERNS: [MemberRequestKind, RegExp][] = [
  ["death", /\bdeath\b|\bdeceased\b|\bdied\b|\bestate of\b/],
  ["property", /\bproperty\b|\bmortgage\b|\bdwelling\b|\bresidential land\b/],
  [
    "cessation_of_residence",
    /outside the (cayman )?islands|\boverseas\b|left the (cayman )?islands|ceased? to reside|international transfer/,
  ],
  ["retirement", /\bretire|retirement savings arrangement|\bannuity\b/],
  ["transfer_out", /\btransfer\b|new employer|changing employer/],
];

/** Which kind of Member request a text is about, by keywords; a `Request type:` line wins. */
export function classifyByKeywords(text: string): {
  kind: MemberRequestKind | null;
  reason: string;
} {
  const lower = text.toLowerCase();
  const stated = /request type\s*:\s*(.+)/i.exec(text)?.[1]?.toLowerCase();
  for (const source of [stated, lower]) {
    if (!source) continue;
    for (const [kind, pattern] of KIND_PATTERNS) {
      const match = pattern.exec(source);
      if (match) {
        return {
          kind,
          reason:
            source === stated
              ? `The papers say "Request type: ${stated?.trim()}".`
              : `The papers mention "${match[0]}".`,
        };
      }
    }
  }
  return { kind: null, reason: "No keyword names a kind of request." };
}

const PAPER_PATTERNS: [DocumentType, RegExp][] = [
  ["international_questionnaire", /questionnaire/],
  ["transfer_form", /transfer request|transfer form|transfer direction/],
  [
    "receiving_plan_document",
    /plan document|prospectus|plan rules|receiving plan/,
  ],
  [
    "property_form",
    /property withdrawal|schedule form|withdrawal application|application for (a )?withdrawal/,
  ],
  [
    "caymanian_status",
    /caymanian status|certificate of caymanian|status certificate/,
  ],
  ["lender_letter", /lender|approval[- ]in[- ]principle/],
  ["non_home_owner_declaration", /non[- ]?(current )?home[- ]?owner/],
  ["land_register", /land register/],
  ["retirement_application", /retirement application|application to retire/],
  ["death_certificate", /death certificate/],
  ["claimant_id", /claimant'?s? (photo )?id/],
  [
    "proof_of_relationship",
    /proof of relationship|marriage certificate|birth certificate/,
  ],
  ["photo_id", /passport|driver'?s licen[cs]e|photo id/],
  ["request_letter", /letter|request/],
];

/** The paper a section title names. */
export function paperTypeOf(title: string): DocumentType {
  const lower = title.toLowerCase();
  for (const [type, pattern] of PAPER_PATTERNS) {
    if (pattern.test(lower)) return type;
  }
  return "other";
}

const SECTION = /^\s*#{0,3}\s*document\s*[:\-–]\s*(.+?)\s*$/gim;

/** The papers in a Source: one per `Document: <title>` section, or the whole text as one. */
export function papersIn(title: string, text: string): PaperFound[] {
  const sections = [...text.matchAll(SECTION)];
  if (sections.length === 0) {
    return [
      {
        type:
          paperTypeOf(title) === "other"
            ? "request_letter"
            : paperTypeOf(title),
        title,
        signed: signedIn(text),
      },
    ];
  }
  return sections.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = sections[index + 1]?.index ?? text.length;
    const name = match[1] ?? "Paper";
    return {
      type: paperTypeOf(name),
      title: name,
      signed: signedIn(text.slice(start, end)),
    };
  });
}

function signedIn(text: string): boolean | null {
  const answers = [...text.matchAll(/signed[^:\n]*:\s*(yes|no)\b/gi)].map(
    (match) => (match[1] ?? "").toLowerCase(),
  );
  if (answers.length === 0) return null;
  return answers.every((answer) => answer === "yes");
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** `1960-03-12` or `12 March 1960` as an ISO date, else null. */
export function dateIn(value: string | undefined): string | null {
  if (!value) return null;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(value)?.[1];
  if (iso && isIsoDate(iso)) return iso;
  const words = /\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/i.exec(value);
  if (!words) return null;
  const month = MONTHS.indexOf((words[2] ?? "").toLowerCase());
  if (month < 0) return null;
  const date = `${words[3]}-${String(month + 1).padStart(2, "0")}-${String(words[1]).padStart(2, "0")}`;
  return isIsoDate(date) ? date : null;
}

const field = (text: string, pattern: RegExp) =>
  pattern.exec(text)?.[1]?.trim() || null;

function purposeIn(text: string): PropertyPurpose | null {
  const stated = field(text, /^\s*purpose\s*:\s*(.+)$/im)?.toLowerCase();
  if (!stated) return null;
  if (/pay[- ]?off|pay it off|in full/.test(stated)) return "payoff";
  if (/reduc/.test(stated)) return "reduction";
  if (/deposit|purchase|buy|build|land/.test(stated)) return "deposit";
  return null;
}

/** Reads one Source by its labelled fields. */
export function readByRules(source: {
  id: string;
  title: string;
  text: string;
}): DocumentReading {
  const text = source.text;
  const amount = field(
    text,
    /^\s*(?:amount requested|withdrawal amount|amount)\s*:\s*(?:CI\$|KYD|\$)?\s*([\d,]+(?:\.\d{1,2})?)/im,
  );
  const memberNo = MEMBER_NO.exec(text)?.[0];
  const stated = field(text, /^\s*request type\s*:\s*(.+)$/im);
  return {
    sourceId: source.id,
    sourceTitle: source.title,
    papers: papersIn(source.title, text),
    memberNo: memberNo ? normaliseMemberNo(memberNo) : null,
    fullName: field(
      text,
      /^\s*(?:member(?:'s)? (?:full )?name|name of member|full name)\s*:\s*(.+)$/im,
    ),
    dateOfBirth: dateIn(
      field(text, /^\s*date of birth\s*:\s*(.+)$/im) ?? undefined,
    ),
    requestKind: stated
      ? classifyByKeywords(`Request type: ${stated}`).kind
      : null,
    requestedAmountKyd: amount ? Number(amount.replace(/,/g, "")) : null,
    propertyPurpose: purposeIn(text),
    asksCashRefund:
      /cash refund|refund in cash|pay (me|my balance) in cash|cash payment of my/i.test(
        text,
      ),
    receivingPlan: field(text, /^\s*receiving plan(?: name)?\s*:\s*(.+)$/im),
    dateOfDeath: dateIn(
      field(text, /^\s*date of death\s*:\s*(.+)$/im) ?? undefined,
    ),
    fallback: true,
  };
}
