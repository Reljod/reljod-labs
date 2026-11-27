/**
 * The HTTP contract: every path the browser calls, what each takes and what
 * each answers. Reads are gated GET routes and writes are POST or PUT routes
 * on resources, all on the REST pipeline (`server/api.ts`); none is a server
 * action, which a browser sends one at a time (a live Call has a tool call,
 * transcript reports and the hang-up in flight together).
 */
import { z } from "zod";
import {
  type CallEvent,
  type CallStatus,
  type CallSummary,
  type CallView,
  scenarioSchema,
} from "./contract";
import { LIMITS } from "./limits";
import type { Rulebook, RuleVersionRow } from "./rules";
import type { BackOfficeRecord } from "./world";

export const API = "/api/switchboard";

export const paths = {
  state: `${API}/state`,
  calls: `${API}/calls`,
  call: (id: string) => `${API}/calls/${id}`,
  tools: (id: string) => `${API}/calls/${id}/tools`,
  events: (id: string) => `${API}/calls/${id}/events`,
  turns: (id: string) => `${API}/calls/${id}/turns`,
  end: (id: string) => `${API}/calls/${id}/end`,
  callback: (id: string) => `${API}/calls/${id}/callback`,
  reset: `${API}/records/reset`,
  rule: (id: string) => `${API}/rules/${encodeURIComponent(id)}`,
  restore: (id: string) => `${API}/rules/${encodeURIComponent(id)}/restore`,
  tokens: `${API}/tokens`,
  trail: `${API}/trail`,
} as const;

// Requests ------------------------------------------------------------------------------

export const startCallSchema = z.object({
  line: z.enum(["voice", "text"]),
  model: z.string().max(120).optional(),
  scenario: scenarioSchema,
});
export type StartCallRequest = z.input<typeof startCallSchema>;

/** The model's arguments, as the JSON text it produced; text that is not JSON reaches the Back office as null. */
const toolArguments = z
  .string()
  .max(8000)
  .transform((text): unknown => {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });

export const toolRequestSchema = z.object({
  toolCallId: z.string().min(1).max(120),
  name: z.string().min(1).max(60),
  arguments: toolArguments,
  saying: z
    .string()
    .max(LIMITS.transcriptChars * 2)
    .optional(),
  hearing: z
    .string()
    .max(LIMITS.transcriptChars * 2)
    .optional(),
});
export type ToolRequest = z.input<typeof toolRequestSchema>;

/** Each event is checked on its own (`reportedEventSchema`); one that does not fit is dropped. */
export const reportSchema = z.object({
  events: z.array(z.unknown()).max(LIMITS.eventsPerRequest),
});

export const turnSchema = z.object({
  text: z.string().min(1).max(LIMITS.turnChars),
});

export const callQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
});

export const trailQuerySchema = z.object({
  before: z.coerce.number().int().min(1).optional(),
});

export const ruleEditSchema = z.object({
  enabled: z.unknown(),
  params: z.unknown(),
  note: z.string().max(200).optional(),
});
export type RuleEditRequest = z.input<typeof ruleEditSchema>;

// Answers -------------------------------------------------------------------------------

export type RateUse = Record<
  "call" | "turn",
  { used: number; perHour: number }
>;

export type RulesView = { rulebook: Rulebook; versions: RuleVersionRow[] };

/** Everything the page shows first. */
export type FirstView = {
  records: BackOfficeRecord[];
  rules: RulesView;
  calls: CallSummary[];
  rates: RateUse;
  sandbox: boolean;
};

export type SessionGrantView = {
  token: string;
  url: string;
  model: string;
  mintMs: number;
  config: {
    instructions: string;
    voice: string | undefined;
    tools: {
      type: "function";
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }[];
    sampleRate: number;
  };
};

export type StartCallResponse = {
  call: CallView;
  events: CallEvent[];
  /** The voice Line only: what opens the realtime Session. */
  session: SessionGrantView | null;
};

export type CallResponse = { call: CallView; events: CallEvent[] };

export type ToolResponse = {
  ok: boolean;
  output: Record<string, unknown>;
  summary: string;
  events: CallEvent[];
  over: CallStatus | null;
};

export type ReportResponse = {
  accepted: number;
  status: CallStatus;
  costUsd: number;
};

/** A saved Rule edit: the Version the next Call starts under. */
export type SavedRuleResponse = { ruleId: string; version: number };

/** The MCP token, shown once. */
export type TokenResponse = { token: string; expiresAt: string };

export type TrailResponse = { events: CallEvent[] };
export type CallsResponse = { calls: CallSummary[] };
