import type { CheckFinding } from "./rules";
import type { Verification } from "./verify";
import type { ParamValues, QueryResult, ViewSpec } from "./view";

/**
 * What the MCP server hands the App: the `structuredContent` of
 * `create_view`, `show_view` and `update_view_params`. The App draws from
 * this and nothing else, on the page and inside Claude alike. Types only, so
 * the App bundle can import it.
 */

export const VIEW_PAYLOAD_KIND = "canvas.view";

/** The App resource every View tool points at. */
export const VIEW_APP_URI = "ui://canvas/view.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
/** The MCP Apps bridge version the App and the page's Host speak. */
export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

/** The tools the App itself calls through its Host. */
export const APP_TOOLS = {
  updateParams: "update_view_params",
  show: "show_view",
} as const;

/** One Run behind a View: a Query or code, as it ran. */
export type WorkRun = {
  id: string;
  kind: "query" | "code";
  /** What it was for: "View Query", "input load", "exploration". */
  label: string;
  /** The SQL or code as the Analyst wrote it. */
  text: string;
  /** The SQL that ran after the Guard, when it differs. */
  guardedSql: string | null;
  rows: number | null;
  ms: number;
  ok: boolean;
  error: string | null;
  at: string;
};

export type ViewWork = {
  /** Catalog Tables the View's Query reads. */
  tables: string[];
  /** Restricted columns it aggregates. */
  restrictedUsed: string[];
  /** The minimum group size the Guard added, or null when none was needed. */
  minGroupSize: number | null;
  /** The Runs that produced the rows on screen, newest last. */
  runs: WorkRun[];
};

export type ViewStatus = "verified" | "flagged";

export type ViewRecord = {
  id: string;
  conversationId: string | null;
  /** Counts up with every Parameter change and Refresh. */
  revision: number;
  spec: ViewSpec;
  /** The Parameters' current values. */
  params: ParamValues;
  result: QueryResult;
  verification: Verification;
  /** Check findings that did not block the View. */
  findings: CheckFinding[];
  status: ViewStatus;
  rulebookVersion: number;
  work: ViewWork;
  createdAt: string;
  updatedAt: string;
};

/** A region of the fictional Republic of Meridia, for the map kind. */
export type MapRegion = {
  code: string;
  name: string;
  centroid: [number, number];
  /** On a 1000 by 700 canvas, y down. */
  polygon: [number, number][];
};

export type ViewPayload = {
  kind: typeof VIEW_PAYLOAD_KIND;
  view: ViewRecord;
  /** Present when the View is a map. */
  regions?: MapRegion[];
  /** Other Views that share a changed Parameter and were run again with it. */
  linked?: ViewRecord[];
};

export function isViewPayload(value: unknown): value is ViewPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === VIEW_PAYLOAD_KIND &&
    typeof (value as { view?: unknown }).view === "object"
  );
}
