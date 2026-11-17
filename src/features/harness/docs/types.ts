/** What a Docs page is made of, and how the pages are organised. */

export type DiagramId =
  | "architecture"
  | "run-life"
  | "ingest"
  | "oauth"
  | "sandbox-path";

/** A table or list built at render time from a registry, so it cannot drift from the code. */
export type LiveId =
  | "mcp-tools"
  | "permissions"
  | "pipelines"
  | "pipeline-inputs"
  | "pipeline-steps"
  | "rules"
  | "skills"
  | "skill-limits"
  | "audit-actions"
  | "limits"
  | "routes"
  | "sandbox-limits"
  | "staff"
  | "outcomes"
  | "run-statuses"
  | "member-request-kinds";

/** Markdown, a diagram placed between blocks, or a live table. */
export type DocBlock =
  | string
  | { diagram: DiagramId }
  | {
      live: LiveId /** For tables that take one Pipeline: its id. */;
      arg?: string;
    };

export const SECTION_IDS = [
  "introduction",
  "get-started",
  "concepts",
  "desk",
  "using",
  "claude",
  "architecture",
  "reference",
  "operations",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export type DocPage = {
  /** Kebab-case, unique; the `doc` link parameter and `#doc:<id>` links use it. */
  id: string;
  section: SectionId;
  title: string;
  /** One sentence, shown in search results and under the title. */
  summary: string;
  body: DocBlock[];
};

export type DocSection = {
  id: SectionId;
  title: string;
  /** Page ids in reading order. */
  pages: string[];
};
