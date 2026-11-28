import "server-only";
import {
  createMCPClient,
  mcpAppClientCapabilities,
  readMCPAppResource,
} from "@ai-sdk/mcp";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import { type Cap, pgRateLimiter } from "@/platform/rate/limiter";
import { container } from "@/platform/services/container";
import { LIMITS } from "../domain/limits";
import { VIEW_APP_URI } from "../domain/payload";
import { modelAnalyst, scriptedAnalyst } from "./analyst";
import { uploadRepository } from "./catalog";
import { conversationRepository } from "./conversations";
import { env } from "./env";
import { CANVAS_MCP_PATH, mcpHandler } from "./mcp";
import type { CanvasRate, McpClient, McpConnector, SpendKind } from "./ports";
import { rulebookRepository } from "./rules";
import { vercelSandbox } from "./sandbox/session";
import { stubSandbox } from "./sandbox/stub";
import { createCanvasServices } from "./services";
import { trailRepository } from "./trail";
import { viewRepository } from "./views";
import { workspaceRepository } from "./workspace";

const hourly = (max: number, what: string): Cap[] => [
  {
    scope: "visitor",
    window: "hour",
    max,
    message: `That's ${max} ${what} this hour. Try again soon.`,
  },
];

/** The hourly caps in `LIMITS`, per visitor (AGENTS.md: rate limits stay on the visitor hash). */
const rate: CanvasRate = pgRateLimiter<SpendKind>({
  table: "canvas.rate_hits",
  owner: true,
  caps: {
    question: hourly(LIMITS.questionsPerHour, "Questions"),
    run: hourly(LIMITS.runsPerHour, "Runs"),
  },
});

/** The Canvas MCP server, in process: a real MCP client whose fetch is the handler itself. */
const inProcess: McpConnector = async ({ token, origin, clientName }) => {
  const client = await createMCPClient({
    clientName,
    capabilities: mcpAppClientCapabilities,
    transport: {
      type: "http",
      url: `${origin}${CANVAS_MCP_PATH}`,
      headers: { authorization: `Bearer ${token}` },
      fetch: (url, init) => mcpHandler(new Request(url, init), canvas),
    },
  });
  return {
    callTool: (input) => client.callTool(input),
    tools: () => client.tools() as Promise<Record<string, unknown>>,
    async readApp() {
      const app = await readMCPAppResource({ client, uri: VIEW_APP_URI });
      return { html: app.html, meta: app.meta as Record<string, unknown> };
    },
    close: () => client.close(),
  } satisfies McpClient;
};

/**
 * Canvas's composition root. Live: the model gateway and the Owner's
 * Vercel Sandbox (or the local runner in development). Stubbed (e2e without
 * `x-e2e-live: 1`): the scripted Analyst and the canned Sandbox, which
 * parses from statements DuckDB really parsed so the Guard judges real
 * trees. Gates, caps, the Trail and the database are real in both.
 */
export const canvas = container(({ stub }) =>
  createCanvasServices({
    workspace: workspaceRepository,
    conversations: conversationRepository,
    views: viewRepository,
    rulebooks: rulebookRepository,
    uploads: uploadRepository,
    trail: trailRepository,
    rate,
    sandbox: stub ? stubSandbox : vercelSandbox,
    analyst: stub ? scriptedAnalyst : modelAnalyst,
    mcp: inProcess,
    access: {
      guestPass: guestPassOf,
      hostEmails: accessEnv.hostEmails,
      e2eEnabled: () => Boolean(env.e2eBypassToken()),
    },
    secret: env.rateLimitSalt,
    now: Date.now,
    stub,
  }),
);
