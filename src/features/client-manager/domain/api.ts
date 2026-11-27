import { z } from "zod";
import {
  MAX_MESSAGE_LENGTH,
  MAX_PROPOSED_FACTS,
  type ThreadMessage,
  type ThreadSummary,
} from "./chat";
import type {
  BuildStats,
  Persona,
  SourceKind,
  SourceView,
  Usage,
} from "./events";
import { LIMITS } from "./limits";

/**
 * The Client Manager REST API: where each resource lives, what it answers
 * and what it takes. The browser calls it only through `components/api.ts`;
 * the routes under `src/app/api/client-manager/` are thin handlers over the
 * services. Every route passes the Access gate and reads only what the Owner
 * may see (their own clients and Threads, and the Samples). Errors are JSON
 * `{ error }` with 400, 401, 403, 404, 409, 413, 429 or 500.
 */
export const API_ROOT = "/api/client-manager";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client, Build, Thread and Source ids are uuids; anything else is not found. */
export function isUuid(value: string) {
  return UUID.test(value);
}

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  /** GET the Catalog, POST an Intake. */
  clients: () => `${API_ROOT}/clients`,
  /** GET a Client file, DELETE the client. */
  client: (clientId: string) => `${API_ROOT}/clients/${id(clientId)}`,
  /** GET the Edges of one part of the Map: `root`, `branch:<id>`, `leaf:<id>` or `node:<key>`. */
  edges: (clientId: string) => `${API_ROOT}/clients/${id(clientId)}/edges`,
  /** GET one fact in full. */
  node: (clientId: string) => `${API_ROOT}/clients/${id(clientId)}/node`,
  /** GET one Source as it was read. */
  source: (clientId: string, sourceId: string) =>
    `${API_ROOT}/clients/${id(clientId)}/sources/${id(sourceId)}`,
  /** POST an addition (a new Build of the client). */
  builds: (clientId: string) => `${API_ROOT}/clients/${id(clientId)}/builds`,
  /** POST an uploaded or painted Portrait. */
  portrait: (clientId: string) =>
    `${API_ROOT}/clients/${id(clientId)}/portrait`,
  /** POST once the Build's files are uploaded. */
  startBuild: (buildId: string) => `${API_ROOT}/builds/${id(buildId)}/start`,
  /** POST to stop a running Build. */
  stopBuild: (buildId: string) => `${API_ROOT}/builds/${id(buildId)}/stop`,
  /** GET the Build's events as NDJSON, from the `from`th on. */
  buildEvents: (buildId: string) => `${API_ROOT}/builds/${id(buildId)}/events`,
  /** GET the Owner's Threads, POST a new one. */
  threads: () => `${API_ROOT}/threads`,
  /** GET a Thread with its messages, PATCH it, DELETE it. */
  thread: (threadId: string) => `${API_ROOT}/threads/${id(threadId)}`,
  /** POST a question; the answer streams back as NDJSON AssistantEvents. */
  messages: (threadId: string) =>
    `${API_ROOT}/threads/${id(threadId)}/messages`,
  /** POST the person's pick from a Research card. */
  proposal: (threadId: string, messageId: string) =>
    `${API_ROOT}/threads/${id(threadId)}/proposals/${id(messageId)}`,
  /** POST to mint an MCP token to paste. */
  mcpToken: () => `${API_ROOT}/mcp-token`,
};

// Views -----------------------------------------------------------------------------

export type ClientStatus = "building" | "ready" | "failed";
export type BuildStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";
export type BuildTrigger = "intake" | "addition";

export type CatalogCard = {
  id: string;
  name: string;
  isSample: boolean;
  status: ClientStatus;
  building: boolean;
  persona: Persona | null;
  portraitUrl: string | null;
  nodes: number;
  edges: number;
  branches: Record<string, number>;
  createdAt: string;
};

export type NodeLite = {
  key: string;
  label: string;
  type: string;
  category: string;
  summary: string;
  attributes: Record<string, string>;
  confidence: number;
  sourceIds: string[];
  quotes: number;
};

export type SourceSummary = SourceView & {
  createdAt: string;
  buildId: string | null;
  facts: number;
};

/** A client as the dashboard first draws it: no Edges, no quotes; those load as you open things. */
export type ClientSummary = {
  id: string;
  name: string;
  isSample: boolean;
  status: ClientStatus;
  persona: Persona | null;
  portraitUrl: string | null;
  portraitSource: "generated" | "uploaded" | null;
  nodes: NodeLite[];
  edgeCount: number;
  sources: SourceSummary[];
  latestBuild: {
    id: string;
    status: BuildStatus;
    trigger: BuildTrigger;
    stats: BuildStats | null;
    error: string | null;
  } | null;
  spend: { costUsd: number; tokens: number };
  canAdd: boolean;
};

export type EdgeLite = {
  from: string;
  to: string;
  relation: string;
  label: string;
  confidence: number;
  quotes: number;
};

export type Quote = { sourceId: string; quote: string };

export type NodeFull = NodeLite & {
  evidence: Quote[];
  links: (EdgeLite & { evidence: Quote[] })[];
};

export type SourceFull = SourceSummary & {
  text: string | null;
  url: string | null;
  backing: {
    quote: string;
    key: string | null;
    label: string;
    category: string | null;
    confidence: number;
  }[];
};

export type Upload = { sourceId: string; name: string; url: string };

export type CatalogResponse = { clients: CatalogCard[] };
export type ClientResponse = ClientSummary;
export type EdgesResponse = { edges: EdgeLite[] };
export type NodeResponse = NodeFull;
export type SourceResponse = SourceFull;
export type ThreadsResponse = { threads: ThreadSummary[] };
export type ThreadResponse = {
  thread: ThreadSummary;
  messages: ThreadMessage[];
};
/** An Intake: the new client and its first Build, with where to upload each file. */
export type IntakeResponse = {
  clientId: string;
  buildId: string;
  uploads: Upload[];
  portraitUpload: { url: string } | null;
};
export type AdditionResponse = { buildId: string; uploads: Upload[] };
/** Upload step one answers where to PUT (`path`, `url`); confirm and paint answer the new Portrait's link. */
export type PortraitResponse = {
  path?: string;
  url: string | null;
  usage?: Usage;
};
export type McpTokenResponse = {
  token: string;
  kind: "host" | "guest" | "e2e";
  expiresAt: string;
};

// What the routes take -----------------------------------------------------------------

export const clientParamsSchema = z.object({ clientId: z.string().max(64) });
export const sourceParamsSchema = z.object({
  clientId: z.string().max(64),
  sourceId: z.string().max(64),
});
export const buildParamsSchema = z.object({ buildId: z.string().max(64) });
export const threadParamsSchema = z.object({ threadId: z.string().max(64) });
export const proposalParamsSchema = z.object({
  threadId: z.string().max(64),
  messageId: z.string().max(64),
});

export const fileSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.string().max(120),
  size: z.number().int().min(1).max(LIMITS.fileBytes),
});

export type FileMeta = z.infer<typeof fileSchema>;

export const intakeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  note: z.string().max(LIMITS.noteChars).default(""),
  files: z.array(fileSchema).max(LIMITS.files).default([]),
  portrait: fileSchema.nullable().default(null),
  /** Honoured only for the e2e suite and the seed script: a Sample for everyone. */
  sample: z.boolean().default(false),
});

export type IntakeInput = z.infer<typeof intakeSchema>;

export const additionSchema = z.object({
  note: z.string().max(LIMITS.noteChars).default(""),
  files: z.array(fileSchema).max(LIMITS.files).default([]),
});

export type AdditionInput = z.infer<typeof additionSchema>;

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => /^https?:\/\/[^\s]+$/i.test(value),
    "Links must be http(s)",
  );

/** Facts the person approved (from Research) or told the Desk. */
export const factsSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().trim().min(3).max(500),
        sourceUrl: httpUrl.nullish(),
        sourceTitle: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1)
    .max(MAX_PROPOSED_FACTS),
});

export type FactsInput = z.infer<typeof factsSchema>;

/** `root`, `branch:wealth`, `leaf:wealth.accounts` or `node:person:ivy-marsh`. */
export type EdgeScope =
  | { kind: "root" }
  | { kind: "branch"; id: string }
  | { kind: "leaf"; id: string }
  | { kind: "node"; key: string };

export function edgeScopeOf(value: string | undefined): EdgeScope | null {
  if (!value || value === "root") return { kind: "root" };
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  if (!id || id.length > 120) return null;
  if (kind === "branch" && /^[a-z]+$/.test(id)) return { kind, id };
  if (kind === "leaf" && /^[a-z]+\.[a-z_]+$/.test(id)) return { kind, id };
  if (kind === "node") return { kind, key: id };
  return null;
}

export const edgesQuerySchema = z.object({
  scope: z
    .string()
    .max(160)
    .optional()
    .transform((value, context) => {
      const scope = edgeScopeOf(value);
      if (!scope) context.addIssue({ code: "custom", message: "Bad scope" });
      return scope as EdgeScope;
    }),
});

export const nodeQuerySchema = z.object({
  key: z
    .string({ error: "Which fact?" })
    .min(1, "Which fact?")
    .max(160, "That key is too long."),
});

export const buildEventsQuerySchema = z.object({
  from: z.coerce.number().int().min(0).catch(0).default(0),
});

export const portraitSchema = z.discriminatedUnion("mode", [
  // Step one of an upload: where to PUT the image.
  z.object({
    mode: z.literal("upload"),
    name: z.string().max(160),
    type: z.string().startsWith("image/"),
  }),
  // Step two: the image is there; make it the portrait.
  z.object({ mode: z.literal("confirm"), path: z.string().max(300) }),
  // Paint a new one from the Persona.
  z.object({ mode: z.literal("paint") }),
]);

export type PortraitInput = z.infer<typeof portraitSchema>;

export const threadPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  clientId: z.string().uuid().nullable().optional(),
});

export type ThreadPatch = z.infer<typeof threadPatchSchema>;

export const askSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  research: z.boolean().default(false),
});

export type AskInput = z.infer<typeof askSchema>;

export const decisionSchema = z.object({
  action: z.enum(["add", "dismiss"]),
  factIds: z.array(z.string().max(16)).max(40).default([]),
});

export type DecisionInput = z.infer<typeof decisionSchema>;

export type { SourceKind };
