/**
 * The transcript as the screen shows it: Turns, tool calls and what
 * interrupted them, in order. Built from a Call's Events, so a live Call, a
 * saved one and one held over MCP all read the same.
 */
import type { RuleHit } from "./backoffice";
import type { CallEvent, TurnLatency } from "./contract";
import { detectLanguage, type Language } from "./hearing";
import type { RecordKind } from "./world";

export type Item =
  | {
      kind: "caller";
      id: string;
      text: string;
      language: Language;
      via: "voice" | "text" | "sample" | "mcp";
    }
  | {
      kind: "agent";
      id: string;
      text: string;
      language: Language;
      interrupted: boolean;
      latency?: TurnLatency;
      /** Still being said. */
      partial?: boolean;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      ms: number;
      refusal: RuleHit[];
      records: { kind: RecordKind; ref: string; op: "create" | "update" }[];
    }
  | { kind: "note"; id: string; text: string; tone: "barge" | "end" };

export function itemOf(event: CallEvent): Item | null {
  const id = `e${event.id}`;
  switch (event.type) {
    case "turn.caller":
      return {
        kind: "caller",
        id,
        text: event.data.text,
        language: event.data.language,
        via: event.data.via,
      };
    case "turn.agent":
      return {
        kind: "agent",
        id,
        text: event.data.text,
        language: event.data.language,
        interrupted: event.data.interrupted,
        latency: event.data.latency,
      };
    case "tool.result":
      return {
        kind: "tool",
        id,
        name: event.data.name,
        ok: event.data.ok,
        summary: event.data.summary,
        ms: event.data.ms,
        refusal: event.data.refusal,
        records: event.data.records,
      };
    case "barge_in":
      return {
        kind: "note",
        id,
        tone: "barge",
        text: `Barge-in: the Caller cut the Agent off after ${(event.data.playedMs / 1000).toFixed(1)} s`,
      };
    case "call.ended":
      return { kind: "note", id, tone: "end", text: event.data.reason };
    case "call.cut_off":
      return {
        kind: "note",
        id,
        tone: "end",
        text: `Cut off by the server: ${event.data.reason}`,
      };
    default:
      return null;
  }
}

export const itemsOf = (events: CallEvent[]): Item[] =>
  events.flatMap((event) => itemOf(event) ?? []);

let seq = 0;
/** An id for an item the browser made before the server stored its Event. */
export const localId = () => `l${++seq}`;

export const callerItem = (
  text: string,
  via: "voice" | "text" | "sample",
): Item => ({
  kind: "caller",
  id: localId(),
  text,
  language: detectLanguage(text),
  via,
});
