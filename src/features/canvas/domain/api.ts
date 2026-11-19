import type { ConversationSummary, Message } from "./chat";
import type { ViewPayload } from "./payload";
import type { Rulebook } from "./rules";
import type { TrailEvent } from "./trail";

/**
 * The HTTP contract of Canvas: reads are gated GET routes, the Question
 * stream and the App's tool calls are POST routes, other writes are server
 * actions (`server/actions.ts`). The browser calls these only through
 * `components/api.ts`.
 */
export const API = {
  chat: "/api/canvas/chat",
  appFrame: "/api/canvas/app/frame",
  appCall: "/api/canvas/app/call",
  conversations: "/api/canvas/conversations",
  conversation: (id: string) => `/api/canvas/conversations/${id}`,
  rules: "/api/canvas/rules",
  trail: "/api/canvas/trail",
  mcp: "/api/canvas/mcp",
} as const;

export type ConversationListResponse = { conversations: ConversationSummary[] };

export type ConversationResponse = {
  messages: Message[];
  /** The Conversation's Views, oldest first, as the App takes them. */
  views: ViewPayload[];
};

export type RulesResponse = {
  version: number;
  rulebook: Rulebook;
  savedAt: string | null;
  history: { version: number; changed: string[]; savedAt: string }[];
};

export type TrailResponse = { events: TrailEvent[] };

export type CatalogTableInfo = {
  name: string;
  title: string;
  description: string;
  group: string;
  grain: string;
  rows: number;
  columns: { name: string; type: string; description: string; unit?: string }[];
};

export type ErrorResponse = { error: string };
