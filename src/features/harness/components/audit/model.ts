import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEvent,
} from "../../domain/audit";
import type { LinkParams, TabId } from "../../domain/place";

/** Pure helpers behind the Audit tab: totals, CSV, readable detail and links. */

export type AuditTotals = {
  events: number;
  /** Events that carry a model: the Agent's model calls. */
  agentCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** True when some Agent call has no cost, so the sum is a floor. */
  costPartial: boolean;
};

export function auditTotals(events: readonly AuditEvent[]): AuditTotals {
  const totals: AuditTotals = {
    events: events.length,
    agentCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costPartial: false,
  };
  for (const event of events) {
    if (event.model === null) continue;
    totals.agentCalls++;
    totals.inputTokens += event.inputTokens ?? 0;
    totals.outputTokens += event.outputTokens ?? 0;
    if (event.costUsd === null) totals.costPartial = true;
    else totals.costUsd += event.costUsd;
  }
  return totals;
}

/** The action labels in groups, for a grouped select: the part of the id before the dot names the group. */
export const ACTION_GROUPS: { group: string; actions: AuditAction[] }[] =
  (() => {
    const names: Record<string, string> = {
      session: "Sessions",
      staff: "Staff",
      message: "Chat",
      file: "Chat",
      model: "Agent",
      tool: "Agent",
      skill: "Skills",
      web: "Agent",
      run: "Runs",
      step: "Runs",
      finding: "Runs",
      approval: "Runs",
      rule: "Rules",
      source: "Knowledge",
      conflict: "Knowledge",
      sandbox: "Sandbox",
      mcp: "Claude",
      plugin: "Claude",
    };
    const groups = new Map<string, AuditAction[]>();
    for (const action of Object.keys(AUDIT_ACTIONS) as AuditAction[]) {
      const group = names[action.split(".")[0] ?? ""] ?? "Other";
      groups.set(group, [...(groups.get(group) ?? []), action]);
    }
    return [...groups].map(([group, actions]) => ({ group, actions }));
  })();

// CSV ---------------------------------------------------------------------------

export const CSV_COLUMNS = [
  "id",
  "time",
  "actor_kind",
  "actor",
  "action",
  "action_label",
  "target_kind",
  "target_id",
  "summary",
  "session_id",
  "session_title",
  "run_id",
  "model",
  "input_tokens",
  "output_tokens",
  "cost_usd",
  "detail",
] as const;

/**
 * One CSV cell. Quotes a value with a comma, quote or line break, and keeps a
 * spreadsheet from running a text that starts like a formula (`=`, `+`, `-`,
 * `@`, tab, CR) by putting a `'` in front.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function auditCsv(events: readonly AuditEvent[]): string {
  const rows = events.map((event) =>
    [
      event.id,
      event.createdAt,
      event.actorKind,
      event.actorLabel,
      event.action,
      AUDIT_ACTIONS[event.action] ?? event.action,
      event.targetKind,
      event.targetId,
      event.summary,
      event.sessionId,
      event.sessionTitle ?? null,
      event.runId,
      event.model,
      event.inputTokens,
      event.outputTokens,
      event.costUsd,
      Object.keys(event.detail).length > 0 ? JSON.stringify(event.detail) : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

// Sessions ----------------------------------------------------------------------

/** The first characters of a Session id: enough to tell Sessions apart at a glance. */
export const SHORT_ID_CHARS = 8;

export const shortId = (id: string): string => id.slice(0, SHORT_ID_CHARS);

/** Colours a Session can take; the same id always gets the same one, so its rows look related. */
export const SESSION_HUES = [212, 28, 150, 330, 262, 48, 184, 4] as const;

/** A stable hue (degrees) for a Session id, from its characters. */
export function sessionHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SESSION_HUES[hash % SESSION_HUES.length] ?? SESSION_HUES[0];
}

export type SessionChoice = { id: string; title: string };

/**
 * The Sessions a filter can pick: those listed (the Staff member's own) and
 * those the trail has shown (an admin sees other Staff's too), newest listed
 * first, each with its title and short id for the option label.
 */
export function sessionChoices(
  listed: readonly SessionChoice[],
  seen: ReadonlyMap<string, string | null>,
): (SessionChoice & { label: string })[] {
  const byId = new Map<string, string>(listed.map((s) => [s.id, s.title]));
  for (const [id, title] of seen)
    if (!byId.has(id)) byId.set(id, title ?? "Session");
  return [...byId].map(([id, title]) => ({
    id,
    title,
    label: `${title.length > 40 ? `${title.slice(0, 39)}…` : title} (${shortId(id)})`,
  }));
}

// Detail ------------------------------------------------------------------------

export type DetailRow = { key: string; value: string };

const MAX_ROWS = 80;

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** An event's detail as key/value rows: nested objects become `a.b` keys, short lists are joined, so no raw JSON blob is shown. */
export function detailRows(
  detail: Record<string, unknown>,
  action?: string,
): DetailRow[] {
  const rows: DetailRow[] = [];
  const walk = (value: unknown, path: string) => {
    if (rows.length >= MAX_ROWS) return;
    if (Array.isArray(value)) {
      const flat = value.every(
        (item) => item === null || typeof item !== "object",
      );
      if (flat) {
        rows.push({
          key: path,
          value: value.map(scalar).join(" → ").replace(/^$/, "(empty list)"),
        });
        return;
      }
      for (const [index, item] of value.entries()) {
        walk(item, `${path}[${index + 1}]`);
      }
      return;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) rows.push({ key: path, value: "(empty)" });
      for (const [key, item] of entries)
        walk(item, path ? `${path}.${key}` : key);
      return;
    }
    rows.push({ key: path, value: scalar(value) });
  };
  for (const [key, value] of Object.entries(detail)) walk(value, key);
  if (action?.startsWith("sandbox.")) return rows.map(sandboxRow);
  return rows;
}

const SANDBOX_KEYS: Record<string, string> = {
  command: "Command",
  timeoutMs: "Time limit",
  exitCode: "Exit code",
  durationMs: "Duration",
  timedOut: "Timed out",
  truncated: "Output cut short",
  step: "Step",
  call: "Run",
  outputHead: "Output (first part)",
  path: "File",
  bytes: "Size",
  via: "Started from",
};

/** Sandbox events record milliseconds and bytes; show them as a reader would say them. */
function sandboxRow(row: DetailRow): DetailRow {
  const label = SANDBOX_KEYS[row.key];
  if (!label) return row;
  let value = row.value;
  const number = Number(value);
  if (Number.isFinite(number) && value !== "") {
    if (row.key === "durationMs" || row.key === "timeoutMs") {
      value =
        number < 1000 ? `${number} ms` : `${(number / 1000).toFixed(1)} s`;
    } else if (row.key === "bytes") {
      value =
        number < 1024 ? `${number} B` : `${(number / 1024).toFixed(1)} KB`;
    }
  }
  if (value === "true") value = "yes";
  if (value === "false") value = "no";
  return { key: label, value };
}

// Links -------------------------------------------------------------------------

export type EventLink =
  | { kind: "session"; label: string; id: string }
  | { kind: "run"; label: string; id: string }
  | { kind: "tab"; label: string; tab: TabId; params: LinkParams };

/** Where an event can take the reader: its Session and Run, and what it was done to. */
export function eventLinks(event: AuditEvent): EventLink[] {
  const links: EventLink[] = [];
  if (event.sessionId) {
    links.push({ kind: "session", label: "Open Session", id: event.sessionId });
  }
  if (event.runId)
    links.push({ kind: "run", label: "Open Run", id: event.runId });
  const id = event.targetId;
  if (id) {
    switch (event.targetKind) {
      case "rule":
        links.push({
          kind: "tab",
          label: "Open Rule",
          tab: "skills",
          params: { rule: id },
        });
        break;
      case "skill":
        links.push({
          kind: "tab",
          label: "Open Skill",
          tab: "skills",
          params: { skill: id },
        });
        break;
      case "source":
        links.push({
          kind: "tab",
          label: "Open Source",
          tab: "knowledge",
          params: { source: id },
        });
        break;
      case "conflict":
        links.push({
          kind: "tab",
          label: "Open Conflict",
          tab: "knowledge",
          params: { conflict: id },
        });
        break;
    }
  }
  return links;
}

/** Whether the event's actor is quiet: System events are drawn small. */
export const isQuiet = (event: Pick<AuditEvent, "actorKind">) =>
  event.actorKind === "system";

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000)
    return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
