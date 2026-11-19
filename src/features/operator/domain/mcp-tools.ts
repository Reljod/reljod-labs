/**
 * The tools of the Operator MCP server (`/api/operator/mcp`), by name. The
 * server registers exactly these (server/mcp.ts; a test checks it), the
 * Connect panel lists them, and the Operator's own tools are the `screen_*`,
 * `run_code`, `load_skill`, `update_plan` and `finish_run` ones: one guarded
 * path for the in-app agent and an outside client (ADR 0025).
 */
export type McpToolInfo = {
  name: string;
  title: string;
  /** One line for the Connect panel. */
  summary: string;
  group: "runs" | "screen" | "rules" | "work";
  /** Also one of the in-app Operator's own tools. */
  operator?: boolean;
};

export const MCP_TOOLS: McpToolInfo[] = [
  {
    name: "list_tasks",
    title: "List sample Tasks",
    summary: "The sample Tasks, their briefs and their Manifests.",
    group: "runs",
  },
  {
    name: "start_run",
    title: "Start a Run",
    summary:
      "Start a Run of a sample Task or your own words. With driver operator the in-app Operator keys it; with driver client you get the keyboard.",
    group: "runs",
  },
  {
    name: "get_run",
    title: "Get a Run",
    summary: "Status, Verdict, Findings, cost and the pending Approval.",
    group: "runs",
  },
  {
    name: "list_runs",
    title: "List Runs",
    summary: "The Owner's Runs, newest first.",
    group: "runs",
  },
  {
    name: "get_trail",
    title: "Read the Trail",
    summary: "A Run's events in order: Turns, Actions, Rules, pauses.",
    group: "runs",
  },
  {
    name: "get_frame",
    title: "Get a Frame",
    summary: "The picture of the Screen after one Action, as an image.",
    group: "runs",
  },
  {
    name: "stop_run",
    title: "Stop a Run",
    summary: "Stop a Run and shut its Screen sandbox.",
    group: "runs",
  },
  {
    name: "decide_approval",
    title: "Approve or refuse",
    summary:
      "Decide a paused Action of a Run the Operator drives. Refused for a Run you drive yourself: nobody approves their own key.",
    group: "runs",
  },
  {
    name: "screen_capture",
    title: "Look at the Screen",
    summary: "The current Screen as an image. Changes nothing.",
    group: "screen",
    operator: true,
  },
  {
    name: "screen_click",
    title: "Click",
    summary: "Click a pixel of the Screen.",
    group: "screen",
    operator: true,
  },
  {
    name: "screen_type",
    title: "Type",
    summary: "Type text into the field that has the cursor.",
    group: "screen",
    operator: true,
  },
  {
    name: "screen_key",
    title: "Press keys",
    summary: "Press Enter, Tab, a function key and so on.",
    group: "screen",
    operator: true,
  },
  {
    name: "screen_scroll",
    title: "Scroll",
    summary: "Scroll a paged list forward or back.",
    group: "screen",
    operator: true,
  },
  {
    name: "screen_wait",
    title: "Wait",
    summary: "Wait a moment, then look again.",
    group: "screen",
    operator: true,
  },
  {
    name: "finish_run",
    title: "Finish",
    summary:
      "Say the Task is done. The harness then checks the Books; the summary decides nothing.",
    group: "screen",
    operator: true,
  },
  {
    name: "run_code",
    title: "Run code",
    summary:
      "Node.js in a sandbox with no network, with the Manifest and what was keyed on disk.",
    group: "work",
    operator: true,
  },
  {
    name: "list_skills",
    title: "List Skills",
    summary: "The playbooks: reading a Screen, keying a Manifest, recovering.",
    group: "work",
  },
  {
    name: "load_skill",
    title: "Load a Skill",
    summary: "The full text of one Skill.",
    group: "work",
    operator: true,
  },
  {
    name: "update_plan",
    title: "Update the plan",
    summary: "The driver's own checklist for the Run, shown on the page.",
    group: "work",
    operator: true,
  },
  {
    name: "get_rulebook",
    title: "Get the Rulebook",
    summary: "The current Rules and their version.",
    group: "rules",
  },
  {
    name: "save_rulebook",
    title: "Save the Rulebook",
    summary: "Save edited Rules as the next version.",
    group: "rules",
  },
  {
    name: "list_rulebook_versions",
    title: "Rulebook history",
    summary: "Every version of the Rulebook, newest first.",
    group: "rules",
  },
];
