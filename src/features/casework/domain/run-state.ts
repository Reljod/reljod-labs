import type {
  CheckId,
  CheckOutcome,
  HitDisposition,
  Recommendation,
  RiskRating,
} from "./checks";
import type { DocumentKind } from "./document-kinds";
import type { JobId } from "./jobs";
import type { PipelineId } from "./pipelines";

export type SourceFormat = "pdf_digital" | "pdf_scanned" | "image" | "csv";

/** A box on a page, normalised to 0-1 with a top-left origin. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Where a value was read: the page and the boxes around the words. */
export type Evidence = { page: number; boxes: Box[] };

export type FieldValue = string | number | boolean | string[] | object[];

/** One Document as a Run sees it: what it is and what was read from it. */
export type RunDocument = {
  id: string;
  name: string;
  mediaType: string;
  sourceFormat: SourceFormat;
  pageCount: number;
  /** Where the file and its page images live in Storage. */
  storagePath?: string;
  pagePaths?: string[];
  /** Set by the sort Job. */
  kind?: DocumentKind;
  /** One line from sorting: what this is, in a reviewer's words. */
  gist?: string;
  /** Set by the read Job: field name to value. */
  fields?: Record<string, FieldValue>;
  /** Field name to where it sits on the page, for the fields that could be traced. */
  evidence?: Record<string, Evidence>;
  /** The parser that produced the text the model read. */
  parser?: "pdfjs" | "tesseract" | "csv" | "vision";
};

export type CheckEvidence = { documentId: string; field?: string };

export type Check = {
  id: CheckId;
  outcome: CheckOutcome;
  /** One sentence citing the actual values. */
  detail: string;
  job: JobId;
  evidence: CheckEvidence[];
};

export type Hit = {
  /** Whose name was screened. */
  screenedName: string;
  role: string;
  hitName: string;
  listType: "sanctions" | "pep" | "adverse_media";
  listSource: string;
  reference: string;
  score: number;
  hitDateOfBirth: string;
  hitNationality: string;
  aliases: string[];
  reason: string;
  disposition?: HitDisposition;
  dispositionReason?: string;
};

export type OwnershipLink = {
  owner: string;
  owned: string;
  percentage: number;
  relation: string;
};

export type Ubo = {
  name: string;
  /** Effective ownership, 0-100; null for control without ownership. */
  percentage: number | null;
  role: string;
  /** How the percentage was reached, e.g. "80% x 50% x 30%". */
  path: string;
  verified: boolean;
};

export type Ownership = {
  top: string;
  links: OwnershipLink[];
  ubos: Ubo[];
  /** People below the threshold, shown for completeness. */
  others: Ubo[];
};

export type ArrearsMonth = {
  period: string;
  due: string;
  expected: number;
  paid: number;
  short: number;
  daysLate: number;
  interest: number;
};

export type Arrears = {
  months: ArrearsMonth[];
  /** Unpaid or short contributions, before interest. */
  total: number;
  interest: number;
};

export type Risk = {
  rating: RiskRating;
  score: number;
  factors: string[];
};

export type Decision = {
  recommendation: Recommendation;
  headline: string;
  summary: string;
  nextSteps: string[];
};

/** A required input the Specialist asked for and was told to go without. */
export type Gap = { job: JobId; wants: string };

/** The blackboard every Job reads from and writes to, carried between steps. */
export type RunState = {
  runId: string;
  /** The review date; every "in date" check uses it. */
  asOf: string;
  pipeline?: PipelineId;
  documents: RunDocument[];
  checks: Check[];
  hits?: Hit[];
  ownership?: Ownership;
  arrears?: Arrears;
  risk?: Risk;
  decision?: Decision;
  gaps: Gap[];
  /** Free-text answers the human gave, by Job. */
  answers: { job: JobId; text: string }[];
};

/** Adds or replaces Checks by id. */
export function withChecks(state: RunState, checks: Check[]): RunState {
  const ids = new Set(checks.map((check) => check.id));
  return {
    ...state,
    checks: [...state.checks.filter((check) => !ids.has(check.id)), ...checks],
  };
}

export function documentsOf(state: RunState, kind: DocumentKind) {
  return state.documents.filter((document) => document.kind === kind);
}

export function firstOf(state: RunState, kind: DocumentKind) {
  return documentsOf(state, kind).find((document) => document.fields);
}

/** A field as text, or "" when absent. */
export function text(document: RunDocument | undefined, field: string) {
  const value = document?.fields?.[field];
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : String(value);
}

export function money(document: RunDocument | undefined, field: string) {
  const value = document?.fields?.[field];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) && value.trim() !== "" ? parsed : null;
  }
  return null;
}

export function flag(document: RunDocument | undefined, field: string) {
  const value = document?.fields?.[field];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|y|1|x|✓)$/i.test(value);
  return false;
}

export function list<T = Record<string, unknown>>(
  document: RunDocument | undefined,
  field: string,
): T[] {
  const value = document?.fields?.[field];
  return Array.isArray(value) ? (value as T[]) : [];
}

export function names(document: RunDocument | undefined, field: string) {
  const value = document?.fields?.[field];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}
