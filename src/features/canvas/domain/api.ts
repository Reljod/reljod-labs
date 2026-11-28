import { z } from "zod";
import type { ConversationSummary, Message } from "./chat";
import { LIMITS } from "./limits";
import type { ViewPayload } from "./payload";
import { RULE_DEFS, type Rulebook, type RuleEditError } from "./rules";
import type { TrailEvent } from "./trail";

/**
 * The HTTP contract of Canvas: gated REST routes over its services (the
 * Question stream and the App's tool calls included), plus the MCP server,
 * which checks its own bearer. The browser calls these only through
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
  tokens: "/api/canvas/tokens",
  mcp: "/api/canvas/mcp",
} as const;

/** `POST /api/canvas/chat`: one Question, in a Conversation or a new one. */
export const questionSchema = z.object({
  text: z.string().max(LIMITS.questionChars),
  conversationId: z.string().uuid().optional(),
});

/** `POST /api/canvas/rules`: Rule edits, saved as a new Version. */
export const ruleEditsSchema = z.object({
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
});

/** `GET /api/canvas/trail`: a page of the Trail, newest first. */
export const trailQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  viewId: z.string().uuid().optional(),
  before: z.coerce.number().int().positive().optional(),
});

/** `POST /api/canvas/app/call`: an App's `tools/call`. */
export const appCallSchema = z.object({
  name: z.string().min(1).max(60),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

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

/** A refused Rule edit: 400 with one error per field at fault. */
export type RuleEditFailure = { error: string; errors?: RuleEditError[] };

export type TrailResponse = { events: TrailEvent[] };

/** A token for an outside MCP client, shown once. */
export type TokenResponse = { token: string; expiresAt: string };

export type CatalogTableInfo = {
  name: string;
  title: string;
  description: string;
  group: string;
  grain: string;
  rows: number;
  columns: { name: string; type: string; description: string; unit?: string }[];
};
