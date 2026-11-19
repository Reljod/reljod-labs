/**
 * The HTTP contract: every path the browser calls and what each answers.
 * Reads are gated GET routes; the writes of a live Call are POST routes too
 * (a browser sends its server actions one at a time, and a Call has tool
 * calls, transcript reports and the hang-up in flight together); every other
 * write is a server action (`server/actions.ts`).
 */
import type {
  CallEvent,
  CallStatus,
  CallSummary,
  CallView,
  Scenario,
} from "./contract";
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
  audio: (id: string) => `${API}/calls/${id}/audio`,
  records: `${API}/records`,
  rules: `${API}/rules`,
  trail: `${API}/trail`,
  supervisor: `${API}/supervisor`,
} as const;

/** The header the end-to-end test sends for canned Agent Turns; honoured only with the e2e token. */
export const STUB_HEADER = "x-switchboard-stub";

export type RateUse = Record<
  "call" | "turn" | "supervisor" | "sandbox",
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

export type StartCallRequest = {
  line: "voice" | "text";
  model?: string;
  scenario: Scenario;
  consentAudio?: boolean;
};

export type StartCallResponse = {
  call: CallView;
  events: CallEvent[];
  /** The voice Line only: what opens the realtime Session. */
  session: SessionGrantView | null;
};

export type CallResponse = { call: CallView; events: CallEvent[] };

export type ToolRequest = {
  toolCallId: string;
  name: string;
  /** The model's arguments, as the JSON text it produced. */
  arguments: string;
  saying?: string;
  hearing?: string;
};

export type ToolResponse = {
  ok: boolean;
  output: Record<string, unknown>;
  summary: string;
  events: CallEvent[];
  over: CallStatus | null;
};

export type ReportResponse = { accepted: number; status: CallStatus; costUsd: number };

export type TrailResponse = { events: CallEvent[] };
export type RecordsResponse = { records: BackOfficeRecord[] };
export type CallsResponse = { calls: CallSummary[] };
export type AudioResponse = { url: string | null };
