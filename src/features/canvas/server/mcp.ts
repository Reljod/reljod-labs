import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { isAppError } from "@/platform/errors";
import type { RequestMode } from "@/platform/request/mode";
import { VIEW_APP_HTML } from "../app/view-app.generated";
import { cutArgs } from "../domain/chat";
import { LIMITS } from "../domain/limits";
import {
  MCP_APP_MIME_TYPE,
  VIEW_APP_URI,
  type ViewPayload,
  type ViewRecord,
} from "../domain/payload";
import { RULE_DEFS, rulebookText } from "../domain/rules";
import { TRAIL_ACTIONS } from "../domain/trail";
import { viewSpecSchema } from "../domain/view";
import type { Caller } from "./ports";
import type { CanvasServices } from "./services";
import { payloadOf } from "./services/views";

/*
 * The Canvas MCP server (ADR 0031): the only way the Analyst reaches
 * anything, and the same server an outside client such as Claude connects
 * to. Every tool calls the service the page's REST routes call, so the
 * Owner scope, the Rules, the limits and the Trail are the same from all
 * three.
 *
 * `create_view`, `show_view` and `update_view_params` are MCP Apps tools:
 * they point at the UI resource `ui://canvas/view.html` and return the
 * `ViewPayload` the App draws from as `structuredContent`. The model reads
 * only the short text beside it.
 */

export const MCP_SERVER_NAME = "canvas";
export const CANVAS_MCP_PATH = "/api/canvas/mcp";
/** The MCP Apps extension id a client advertises and a server answers to. */
export const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui";

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

/** Who a tool call acts for, and the services (live or stubbed) its bearer runs on. */
type Acting = { caller: Caller; services: CanvasServices };

function actingOf(ctx: unknown): Acting {
  const extra = (ctx as ToolContext)?.http?.authInfo?.extra;
  const caller = extra?.caller as Caller | undefined;
  const services = extra?.services as CanvasServices | undefined;
  if (!caller || !services) throw new Error("Not authorised");
  return { caller, services };
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const said = (text: string, structured?: unknown): ToolResult => ({
  content: [{ type: "text", text }],
  ...(structured === undefined
    ? {}
    : { structuredContent: structured as Record<string, unknown> }),
});

/** A tool that points at the View App (stable key and the older flat one). */
const APP_META = {
  ui: { resourceUri: VIEW_APP_URI, visibility: ["model", "app"] },
  "ui/resourceUri": VIEW_APP_URI,
};

/** What the App's own document may load: nothing. Its script and style are inline. */
const APP_RESOURCE_META = {
  ui: {
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
    prefersBorder: false,
  },
};

// What the model reads -------------------------------------------------------------------------

const cell = (value: unknown) =>
  value === null
    ? ""
    : typeof value === "number"
      ? String(Math.round(value * 10000) / 10000)
      : String(value).slice(0, 60);

/** A result as a small text table: the first rows, and how many there are. */
function tableText(
  result: {
    columns: { name: string; type: string }[];
    rows: unknown[][];
    rowCount: number;
    truncated: boolean;
  },
  shown: number,
) {
  const head = result.columns.map((column) => column.name).join(" | ");
  const types = result.columns.map((column) => column.type).join(" | ");
  const rows = result.rows
    .slice(0, shown)
    .map((row) => row.map(cell).join(" | "));
  const more =
    result.rowCount > rows.length
      ? `\n… ${result.rowCount - rows.length} more rows not shown (${result.rowCount} in all${result.truncated ? ", capped by the row limit" : ""}).`
      : "";
  return `${head}\n${types}\n${rows.join("\n")}${more}`;
}

function viewText(view: ViewRecord, note = "") {
  const lines = [
    `View ${view.id} "${view.spec.title}" (${view.spec.encoding.kind}), revision ${view.revision}: ${view.status.toUpperCase()}.`,
    `${view.result.rowCount} rows in ${view.result.ms} ms. Parameters: ${JSON.stringify(view.params)}.`,
  ];
  for (const claim of view.verification.claims)
    lines.push(
      `Claim ${claim.id} (${claim.label}): stated ${claim.stated}, code computed ${claim.actual ?? "nothing"}: ${claim.ok ? "ok" : `MISMATCH${claim.note ? ` (${claim.note})` : ""}`}.`,
    );
  for (const reason of view.verification.reasons)
    lines.push(`Flagged: ${reason}`);
  for (const finding of view.findings)
    lines.push(`Check finding (${finding.rule}): ${finding.message}`);
  if (view.work.minGroupSize !== null)
    lines.push(
      `The Guard added a minimum group size of ${view.work.minGroupSize} for ${view.work.restrictedUsed.join(", ")}; smaller groups are not in the rows.`,
    );
  if (view.status === "flagged")
    lines.push(
      `To fix it, call create_view again with replaces: "${view.id}" and a Finding whose every number is a Claim that matches the rows.`,
    );
  lines.push(`First rows:\n${tableText(view.result, 8)}`);
  if (note) lines.push(note);
  return lines.join("\n");
}

const scalar = z.union([z.string().max(120), z.number()]);
const paramsSchema = z
  .record(z.string().max(40), scalar)
  .describe("Values for the $name Parameters the SQL uses");

// The tools ------------------------------------------------------------------------------------

export function registerCanvasTools(server: McpServer) {
  /** Registers a tool whose handler's errors become a tool error, and writes its Trail event. */
  const tool = <Schema extends z.ZodType>(
    name: string,
    config: {
      title: string;
      description: string;
      inputSchema: Schema;
      readOnly?: boolean;
      app?: boolean;
    },
    handler: (args: z.infer<Schema>, acting: Acting) => Promise<ToolResult>,
  ) => {
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        annotations: { readOnlyHint: Boolean(config.readOnly) },
        ...(config.app ? { _meta: APP_META } : {}),
      } as never,
      (async (args: z.infer<Schema>, ctx: unknown) => {
        const started = Date.now();
        let acting: Acting;
        try {
          acting = actingOf(ctx);
        } catch {
          return { ...said("Not authorised."), isError: true };
        }
        let result: ToolResult;
        try {
          result = await handler(args, acting);
        } catch (error) {
          unstable_rethrow(error);
          if (!isAppError(error)) console.error(`[canvas] tool ${name}`, error);
          result = {
            ...said(
              isAppError(error)
                ? error.message
                : "The tool failed on our side. Try again.",
            ),
            isError: true,
          };
        }
        await acting.services.trail
          .record(acting.caller, {
            action: result.isError ? "tool.failed" : "tool.called",
            summary:
              `${name}${result.isError ? ` failed: ${result.content[0]?.text ?? ""}` : ""}`.slice(
                0,
                280,
              ),
            detail: { tool: name, args: cutArgs(args) },
            ms: Date.now() - started,
          })
          .catch(() => {});
        return result;
      }) as never,
    );
  };

  tool(
    "list_tables",
    {
      title: "List the Catalog",
      description:
        "Every Table you can query: the open data of the fictional Republic of Meridia (2025) and this Owner's own Uploads, with row counts, grain and column names. Start here.",
      inputSchema: z.object({}),
      readOnly: true,
    },
    async (_args, { caller, services }) => {
      const { tables, restrictedColumns, minGroupSize } =
        await services.catalog.tables(caller.owner);
      const lines = tables.map(
        (table) =>
          `${table.name} (${table.rows.toLocaleString("en")} rows; ${table.grain}) — ${table.title}. Columns: ${table.columns.map((column) => `${column.name} ${column.type}`).join(", ")}`,
      );
      return said(
        `${lines.join("\n")}\n\nRestricted columns (aggregate only, groups of at least ${minGroupSize}): ${restrictedColumns.join(", ") || "none"}.`,
        {
          tables: tables.map((table) => ({
            name: table.name,
            title: table.title,
            group: table.group,
            rows: table.rows,
            grain: table.grain,
            source: table.source,
            columns: table.columns.map((column) => column.name),
          })),
          restrictedColumns,
        },
      );
    },
  );

  tool(
    "describe_table",
    {
      title: "Describe a Table",
      description:
        "One Table's columns with types, units and what each means, and which are Restricted.",
      inputSchema: z.object({ table: z.string().min(1).max(64) }),
      readOnly: true,
    },
    async (args, { caller, services }) => {
      const table = await services.catalog.describe(caller.owner, args.table);
      return said(
        `${table.name}: ${table.description}\nGrain: ${table.grain} ${table.rows.toLocaleString("en")} rows.\n${table.columns
          .map(
            (column) =>
              `- ${column.name} ${column.type}${column.unit ? ` (${column.unit})` : ""}${column.restricted ? " [RESTRICTED: aggregate only]" : ""}: ${column.description}`,
          )
          .join("\n")}`,
        table,
      );
    },
  );

  tool(
    "run_query",
    {
      title: "Run a Query",
      description: `Runs one DuckDB SELECT over Catalog Tables in the Sandbox and returns the first ${LIMITS.rowsShownToAnalyst} rows and the row count. For exploring before you make a View. The Guard refuses anything but a SELECT, files, and a Restricted column outside an aggregate; it tells you what to change.`,
      inputSchema: z.object({
        sql: z.string().min(1).max(LIMITS.queryChars),
        params: paramsSchema.optional(),
        purpose: z
          .string()
          .max(80)
          .optional()
          .describe(
            "A few words on what this checks, shown under Show the work",
          ),
      }),
      readOnly: true,
    },
    async (args, { caller, services }) => {
      const ran = await services.runs.query(caller, {
        sql: args.sql,
        params: args.params,
        label: args.purpose ?? "Exploration",
        maxRows: LIMITS.rowsShownToAnalyst,
      });
      const note =
        ran.statement.guardedSelects > 0
          ? `\nThe Guard added a minimum group size of ${ran.context.rules.minGroupSize} (Restricted: ${ran.statement.restrictedUsed.join(", ")}).`
          : "";
      return said(
        `${ran.result.rowCount} rows in ${ran.result.ms} ms.${note}\n${tableText(ran.result, LIMITS.rowsShownToAnalyst)}`,
        {
          columns: ran.result.columns,
          rows: ran.result.rows,
          rowCount: ran.result.rowCount,
          truncated: ran.result.truncated,
          ms: ran.result.ms,
          guardedSql: ran.run.guardedSql,
        },
      );
    },
  );

  tool(
    "run_code",
    {
      title: "Run code",
      description:
        "Runs Python in the Sandbox (no network; DuckDB and numpy installed) over the results of guarded SELECTs. `import canvas`: canvas.inputs[name] is a Parquet path, canvas.sql(query) is DuckDB with each input as a view, canvas.rows(name) its rows, canvas.params the Parameters, canvas.table(columns, rows) sets a result table. Returns stdout, stderr and the table's first rows. Use it when SQL alone is awkward: decomposition, a fit, a custom score.",
      inputSchema: z.object({
        inputs: z
          .array(
            z.object({
              name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
              sql: z.string().min(1).max(LIMITS.queryChars),
            }),
          )
          .min(1)
          .max(4),
        code: z.string().min(1).max(LIMITS.queryChars),
        params: paramsSchema.optional(),
        purpose: z.string().max(80).optional(),
      }),
      readOnly: true,
    },
    async (args, { caller, services }) => {
      const ran = await services.runs.code(caller, {
        inputs: args.inputs,
        code: args.code,
        params: args.params,
        label: args.purpose ?? "Exploration",
      });
      const table =
        ran.result.columns.length > 0
          ? `\nresult table:\n${tableText(ran.result, 30)}`
          : "";
      return said(
        `exit ${ran.output?.exitCode ?? 0} in ${ran.run.ms} ms\nstdout:\n${ran.output?.stdout || "(empty)"}${ran.output?.stderr ? `\nstderr:\n${ran.output.stderr}` : ""}${table}`,
        {
          stdout: ran.output?.stdout ?? "",
          stderr: ran.output?.stderr ?? "",
          exitCode: ran.output?.exitCode ?? 0,
          table: ran.result.columns.length > 0 ? ran.result : null,
        },
      );
    },
  );

  tool(
    "create_view",
    {
      title: "Make a View",
      description:
        "Answers with a working interface: makes a View from a spec in the View grammar (canvas.view/1) and shows it. The spec carries the Query (SQL with $name Parameters, or code over inputs), the encoding (line, area, bar, scatter, heatmap, pie, table, map, stat), Controls bound to Parameters, Annotations, the Finding in words and its Claims. Code runs the Query, checks the chart Rules and recomputes every Claim from the rows: the View comes back VERIFIED or FLAGGED with what did not match. Every number in the Finding must be a Claim (dates, years and Parameter values are exempt). A Control change later re-runs the same Query with new Parameter values, with no model call, so write the SQL to depend on the Parameters. Pass `replaces` with a View id to revise that View in place instead of making another.",
      inputSchema: z.object({
        spec: viewSpecSchema,
        replaces: z
          .string()
          .uuid()
          .optional()
          .describe("The id of a View to revise in place"),
      }),
      app: true,
    },
    async (args, { caller, services }) => {
      const view = await services.views.create(caller, args);
      return said(viewText(view), payloadOf(view));
    },
  );

  tool(
    "show_view",
    {
      title: "Show a View",
      description:
        "Shows a View that already exists, as it stands (its current Parameter values and rows).",
      inputSchema: z.object({ viewId: z.string().uuid() }),
      readOnly: true,
      app: true,
    },
    async (args, { caller, services }) => {
      const view = await services.views.get(caller.owner, args.viewId);
      return said(viewText(view), payloadOf(view));
    },
  );

  tool(
    "update_view_params",
    {
      title: "Change a View's Parameters",
      description:
        "Sets Parameter values on a View and runs its saved Query again with them. This is what a Control, a Brush or a drill-down in the View calls; no model is involved. Views beside it that declare a Parameter of the same name and type are run again too (Linked Views).",
      inputSchema: z.object({
        viewId: z.string().uuid(),
        params: z.record(z.string().max(40), z.unknown()),
      }),
      app: true,
    },
    async (args, { caller, services }) => {
      const { view, linked } = await services.views.updateParams(caller, args);
      const payload: ViewPayload = payloadOf(view, linked);
      return said(
        viewText(
          view,
          linked.length > 0
            ? `Linked Views run again: ${linked.map((item) => `"${item.spec.title}"`).join(", ")}.`
            : "",
        ),
        payload,
      );
    },
  );

  tool(
    "list_views",
    {
      title: "List Views",
      description:
        "The Views of this Conversation (or, for an outside client, the Owner's latest), with id, title, kind and status.",
      inputSchema: z.object({}),
      readOnly: true,
    },
    async (_args, { caller, services }) => {
      const views = await services.views.list(
        caller.owner,
        caller.conversationId,
      );
      return said(
        views.length === 0
          ? "No Views yet."
          : views
              .map(
                (view) =>
                  `${view.id} — "${view.spec.title}" (${view.spec.encoding.kind}, ${view.status}); Parameters ${JSON.stringify(view.params)}`,
              )
              .join("\n"),
        {
          views: views.map((view) => ({
            id: view.id,
            title: view.spec.title,
            kind: view.spec.encoding.kind,
            status: view.status,
            params: view.params,
          })),
        },
      );
    },
  );

  // Rules, Skills, Trail -------------------------------------------------------------------

  tool(
    "get_rules",
    {
      title: "Get the Rules",
      description:
        "The Owner's Rulebook as sentences with their current values: verification tolerance, Restricted columns and minimum group size, row and time limits, chart Rules.",
      inputSchema: z.object({}),
      readOnly: true,
    },
    async (_args, { caller, services }) => {
      const current = await services.rules.current(caller.owner);
      return said(rulebookText(current.rulebook, current.version), {
        version: current.version,
        rules: current.rulebook,
      });
    },
  );

  tool(
    "save_rules",
    {
      title: "Save Rule edits",
      description: `Saves edits as a new Version of the Rulebook. Each edit names a Rule (${RULE_DEFS.map((rule) => rule.id).join(", ")}) and gives \`enabled\` and/or new \`params\`. A value outside a Rule's range is refused.`,
      inputSchema: z.object({
        edits: z
          .array(
            z.object({
              id: z.string().max(60),
              enabled: z.boolean().optional(),
              params: z.record(z.string().max(40), z.unknown()).optional(),
            }),
          )
          .min(1)
          .max(RULE_DEFS.length),
      }),
    },
    async (args, { caller, services }) => {
      const saved = await services.rules.save(caller, args.edits);
      return said(
        `Rulebook v${saved.version}.\n${rulebookText(saved.rulebook, saved.version)}`,
        { version: saved.version, changed: saved.changed },
      );
    },
  );

  tool(
    "list_skills",
    {
      title: "List Skills",
      description: "The Skills on offer, each a short SKILL.md you can load.",
      inputSchema: z.object({}),
      readOnly: true,
    },
    async (_args, { services }) => {
      const skills = services.catalog.skills();
      return said(
        skills.map((skill) => `${skill.id}: ${skill.description}`).join("\n"),
        {
          skills: skills.map(({ id, name, description }) => ({
            id,
            name,
            description,
          })),
        },
      );
    },
  );

  tool(
    "load_skill",
    {
      title: "Load a Skill",
      description:
        "Returns a Skill's full SKILL.md. Load one before a task it describes.",
      inputSchema: z.object({ skill: z.string().min(1).max(60) }),
      readOnly: true,
    },
    async (args, { caller, services }) => {
      const skill = await services.catalog.loadSkill(caller, args.skill);
      return said(skill.body, { id: skill.id, name: skill.name });
    },
  );

  tool(
    "get_trail",
    {
      title: "Read the Trail",
      description: `The append-only Trail of what was asked, run, made and changed, newest first. Actions: ${Object.keys(TRAIL_ACTIONS).join(", ")}.`,
      inputSchema: z.object({
        viewId: z.string().uuid().optional(),
        boardId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      readOnly: true,
    },
    async (args, { caller, services }) => {
      const events = await services.trail.list(caller.owner, {
        viewId: args.viewId,
        boardId: args.boardId,
        limit: args.limit ?? 30,
      });
      return said(
        events
          .map(
            (event) =>
              `${event.createdAt} ${event.actorKind} ${event.action}: ${event.summary}`,
          )
          .join("\n") || "Nothing on the Trail yet.",
        { events },
      );
    },
  );

  // The View App: one HTML document, the same for this site's page and for Claude.
  server.registerResource(
    "canvas-view",
    VIEW_APP_URI,
    {
      title: "Canvas View",
      description:
        "Draws a View from the View grammar: chart, Controls, Finding, Claims and Show the work.",
      mimeType: MCP_APP_MIME_TYPE,
      _meta: APP_RESOURCE_META,
    } as never,
    async (uri, ctx) => {
      try {
        const { caller, services } = actingOf(ctx);
        await services.trail.record(caller, {
          action: "app.resource_read",
          summary: `App resource read: ${VIEW_APP_URI}`,
          detail: { uri: VIEW_APP_URI, bytes: VIEW_APP_HTML.length },
        });
      } catch {
        // The document is the same for everyone; the event is best effort.
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: MCP_APP_MIME_TYPE,
            text: VIEW_APP_HTML,
            _meta: APP_RESOURCE_META,
          },
        ],
      };
    },
  );
}

// The handler ----------------------------------------------------------------------------------

const handler = createMcpHandler(registerCanvasTools, {
  serverInfo: { name: MCP_SERVER_NAME, version: "1.0.0" },
  capabilities: {
    extensions: {
      [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME_TYPE] },
    },
  },
} as never);

/** Canvas's services in a mode: the container (`container.ts`). */
export type CanvasContainer = (
  mode?: Pick<RequestMode, "stub">,
) => CanvasServices;

/** The container each request's tools run on, for the auth wrapper to resolve. */
const containerOf = new WeakMap<Request, CanvasContainer>();

/**
 * Every request carries a Canvas token: a chat turn's, the page Host's, or
 * one a person took for an outside client. Its holder must still have
 * Access, checked on every call, so a token dies with its Guest pass. The
 * token also says which adapters its tools run on: only one minted for the
 * e2e suite without `x-e2e-live` asks for the canned ones.
 */
const authenticated = withMcpAuth(
  handler,
  async (request, bearer) => {
    const services = containerOf.get(request);
    if (!bearer || !services) return undefined;
    const holder = await services().connect.bearer(bearer);
    if (!holder) return undefined;
    return {
      token: bearer,
      clientId: `canvas-${holder.caller.actor}`,
      scopes: ["canvas"],
      extra: {
        caller: holder.caller,
        services: services({ stub: holder.stub }),
      },
    };
  },
  { required: true },
);

/** The Canvas MCP server's entry point: the route's, and the in-process clients' of the chat and the Host. */
export function mcpHandler(
  request: Request,
  services: CanvasContainer,
): Promise<Response> {
  containerOf.set(request, services);
  return authenticated(request);
}
