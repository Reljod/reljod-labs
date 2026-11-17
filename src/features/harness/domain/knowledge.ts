/** The Knowledge base: Sources, the Passages search finds, and Conflicts (ADR 0016). */

export const SOURCE_KINDS = [
  "pdf",
  "sheet",
  "csv",
  "doc",
  "text",
  "web",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export type SourceStatus = "pending" | "reading" | "ready" | "failed";

/** One document in the Knowledge base. */
export type SourceView = {
  id: string;
  title: string;
  kind: SourceKind;
  bytes: number;
  /** Shipped with the Workspace; cannot be removed. */
  isSeed: boolean;
  status: SourceStatus;
  error: string | null;
  addedBy: { id: string; name: string } | null;
  sessionId: string | null;
  /** The date the document itself carries (`YYYY-MM-DD`). */
  documentDate: string | null;
  passages: number;
  openConflicts: number;
  createdAt: string;
};

/** A piece of a Source small enough to retrieve and cite. */
export type Passage = {
  id: number;
  sourceId: string;
  ordinal: number;
  heading: string | null;
  body: string;
  /** The Passage that replaced this one, by a Resolution. */
  supersededBy: number | null;
  supersededAt: string | null;
};

/** One Passage that search found, with what the citation needs. */
export type PassageHit = {
  passageId: number;
  sourceId: string;
  sourceTitle: string;
  sourceKind: SourceKind;
  documentDate: string | null;
  ordinal: number;
  heading: string | null;
  body: string;
  /** Reciprocal rank fusion of the two searches; higher is closer. */
  score: number;
  /** Cosine similarity, when the meaning search found it. */
  semantic: number | null;
  /** Full-text rank, when the word search found it. */
  lexical: number | null;
  /** An answer that cites this Passage must say a Conflict is open. */
  conflictOpen: boolean;
};

export const RESOLUTIONS = ["supersede", "keep_both", "set_aside"] as const;

/**
 * What a person decided about a Conflict: the new Passage supersedes the old
 * one, both stay with their dates, or the new one is set aside.
 */
export type Resolution = (typeof RESOLUTIONS)[number];

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  supersede: "The new Passage supersedes the old one",
  keep_both: "Both stay, with their dates",
  set_aside: "The new Passage is set aside",
};

export type ConflictSide = {
  passageId: number;
  sourceId: string;
  sourceTitle: string;
  documentDate: string | null;
  heading: string | null;
  body: string;
};

/** Two Passages that say different things about the same fact. */
export type ConflictView = {
  id: string;
  newPassage: ConflictSide;
  oldPassage: ConflictSide;
  summary: string;
  /** What the Agent proposes; an admin decides. */
  proposal: Resolution;
  reasoning: string | null;
  status: "open" | "resolved";
  resolution: Resolution | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  createdAt: string;
};
