import type { ConflictView, SourceView } from "./knowledge";
import type { Place, TabId } from "./place";
import type { RuleView } from "./rules";
import type { RunSummary } from "./run";
import type { MessageView, SessionSummary } from "./session";
import type { SkillView } from "./skills";

/**
 * What a tab shows first, as the list reads it makes when it mounts. The
 * page reads them on the server for the tab in the address (and for Chat,
 * which is always mounted), and the browser prefetches them when a tab is
 * about to be opened, so neither waits for the tab to ask.
 *
 * The Audit tab's first read is its trail, whose query depends on filters
 * the tab keeps itself; only its Session list is read ahead.
 */
export const LIST_READS = [
  "sessions",
  "runs",
  "rules",
  "skills",
  "sources",
  "conflicts",
] as const;

export type ListRead = (typeof LIST_READS)[number];

export const TAB_READS = {
  chat: ["sessions", "runs"],
  pipelines: ["runs", "rules"],
  knowledge: ["sources", "conflicts"],
  skills: ["skills", "rules"],
  audit: ["sessions"],
  docs: [],
} as const satisfies Record<TabId, readonly ListRead[]>;

/** The reads a page load makes: Chat's (always mounted), the address's tab's, once each. */
export function readsFor(place: Place): ListRead[] {
  return [...new Set<ListRead>([...TAB_READS.chat, ...TAB_READS[place.tab]])];
}

/**
 * The first view the page hands the browser. A read that failed on the
 * server is left out, and the tab reads it itself (and shows its own error).
 */
export type FirstView = {
  sessions?: SessionSummary[];
  runs?: RunSummary[];
  rules?: RuleView[];
  skills?: SkillView[];
  sources?: SourceView[];
  conflicts?: ConflictView[];
  /** The Session in the address, when the Staff member may read it. */
  messages?: { sessionId: string; messages: MessageView[] };
};
