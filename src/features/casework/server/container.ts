import "server-only";
import { randomUUID } from "node:crypto";
import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { getRun as getWorkflowRun, resumeHook, start } from "workflow/api";
import { container } from "@/platform/services/container";
import { API_ROOT } from "../domain/api";
import type { RunEvent } from "../domain/run-events";
import {
  bucket,
  cabinetStore,
  deskStore,
  messageStore,
  runStore,
  spendStore,
} from "./adapters";
import { env } from "./env";
import { callOptions, trackCall } from "./llm";
import { createCaseworkMcp } from "./mcp";
import type { McpConnector, RunWorkflows } from "./ports";
import { caseworkRun } from "./run-workflow";
import { createChatService } from "./services/chat";
import { createDeskService } from "./services/desks";
import { createRunService } from "./services/runs";
import { createUploadService } from "./services/uploads";
import { sessionToken } from "./session";
import { scriptedSpecialistModel } from "./stubs";

/** Runs as durable workflows; a stubbed request's Runs read with the labelled Reader. */
function workflows(stub: boolean): RunWorkflows {
  return {
    async start(input) {
      const run = await start(caseworkRun, [
        { ...input, ctx: { ...input.ctx, stub } },
      ]);
      return run.runId;
    },
    async cancel(workflowRunId) {
      await getWorkflowRun(workflowRunId).cancel({
        cancelReason: "Stopped by the person",
      });
    },
    async announceStopped(workflowRunId) {
      const writer = getWorkflowRun(workflowRunId)
        .getWritable<RunEvent>()
        .getWriter();
      const at = Date.now();
      await writer.write({
        at,
        type: "log",
        level: "warn",
        text: "■ stopped by the person",
      });
      await writer.write({ at, type: "end", status: "stopped" });
      await writer.close();
    },
    events: (workflowRunId, from) =>
      getWorkflowRun(workflowRunId).getReadable<RunEvent>({ startIndex: from }),
    async resume(token, answer) {
      await resumeHook(token, answer);
    },
  };
}

/**
 * Casework's composition root for requests: the REST routes, the page and
 * the MCP route share these services. `stub` (an e2e request without
 * `x-e2e-live: 1`) swaps the paid models for scripts: the Specialist's chat
 * model, and the Reader every Run it starts uses. Gates, caps, the MCP
 * server, the workflows and the database stay real.
 */
export const casework = container(({ stub }) => {
  const desks = createDeskService({
    desks: deskStore,
    cabinet: cabinetStore,
    runs: runStore,
    messages: messageStore,
    spend: spendStore,
    storage: bucket,
  });
  const runs = createRunService({
    runs: runStore,
    cabinet: cabinetStore,
    desks: deskStore,
    spend: spendStore,
    workflows: workflows(stub),
    settings: desks.settings,
    now: Date.now,
  });
  const uploads = createUploadService({
    cabinet: cabinetStore,
    storage: bucket,
    secret: env.rateLimitSalt,
    newId: randomUUID,
    now: Date.now,
  });
  const mcp = createCaseworkMcp({ desks, runs, outsideToken: env.mcpToken });
  /** The desk speaks real MCP to its own server, without leaving the process. */
  const connect: McpConnector = async (desk, origin) => {
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: `${origin}${API_ROOT}/mcp`,
        headers: { authorization: `Bearer ${sessionToken(desk)}` },
        fetch: (url, init) => mcp(new Request(url, init)),
      },
    });
    return {
      // @ai-sdk/mcp pins a newer provider-utils patch than ai; the tool shape is the same.
      tools: async () => (await client.tools()) as unknown as ToolSet,
      close: () => client.close(),
    };
  };
  const chat = createChatService({
    spend: spendStore,
    messages: messageStore,
    cabinet: cabinetStore,
    runs: runStore,
    desks: deskStore,
    stopActive: runs.stopActive,
    settings: desks.settings,
    specialist: stub ? scriptedSpecialistModel : callOptions,
    connect,
    track: trackCall,
  });
  return { desks, runs, uploads, chat, mcp };
});

export type CaseworkServices = ReturnType<typeof casework>;
