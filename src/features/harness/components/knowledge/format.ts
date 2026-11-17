import type {
  ConflictView,
  Passage,
  Resolution,
  SourceKind,
  SourceStatus,
} from "../../domain/knowledge";
import { formatDocumentDate } from "../../domain/knowledge/dates";
import type { Tone } from "../ui";

export const KIND_LABEL: Record<SourceKind, string> = {
  pdf: "PDF",
  sheet: "Sheet",
  csv: "CSV",
  doc: "Doc",
  text: "Text",
  web: "Web",
};

/** What a Source's state is called to a person. A pending Source is attached, not yet filed. */
export const STATUS_LABEL: Record<SourceStatus, string> = {
  pending: "Attached, not filed",
  reading: "Reading",
  ready: "Filed",
  failed: "Failed",
};

export const STATUS_TONE: Record<SourceStatus, Tone> = {
  pending: "amber",
  reading: "blue",
  ready: "green",
  failed: "red",
};

export const RESOLUTION_SHORT: Record<Resolution, string> = {
  supersede: "New supersedes old",
  keep_both: "Keep both",
  set_aside: "Set the new one aside",
};

/** What each Resolution does, for the confirm dialog. */
export const RESOLUTION_EFFECT: Record<Resolution, string> = {
  supersede:
    "The old Passage is kept, marked superseded, and left out of search. The new Passage stands.",
  keep_both:
    "Both Passages stay in search, each with its date. Nothing is marked superseded.",
  set_aside:
    "The new Passage is kept, marked superseded by the old one, and left out of search. The old Passage stands.",
};

export const ADMIN_ONLY =
  "Only an admin may settle a Conflict. Switch Staff to try it.";

export const dateLabel = (documentDate: string | null, createdAt: string) =>
  documentDate
    ? formatDocumentDate(documentDate)
    : `added ${new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

/** What replaced a superseded Passage, found from the Conflicts that were settled. */
export function replacementOf(
  passage: Passage,
  conflicts: ConflictView[],
): { sourceId: string; sourceTitle: string; conflictId: string } | null {
  if (passage.supersededBy === null) return null;
  for (const conflict of conflicts) {
    if (conflict.status !== "resolved") continue;
    const replacedBy =
      conflict.resolution === "supersede" &&
      conflict.oldPassage.passageId === passage.id
        ? conflict.newPassage
        : conflict.resolution === "set_aside" &&
            conflict.newPassage.passageId === passage.id
          ? conflict.oldPassage
          : null;
    if (replacedBy) {
      return {
        sourceId: replacedBy.sourceId,
        sourceTitle: replacedBy.sourceTitle,
        conflictId: conflict.id,
      };
    }
  }
  return null;
}
