import "server-only";
import { after } from "next/server";
import { getRun, start } from "workflow/api";
import { redeemCodeOnce } from "@/features/access/server/mcp-tokens";
import { container } from "@/platform/services/container";
import type { BuildEvent } from "../domain/events";
import {
  bucket,
  buildStore,
  clientStore,
  graphStore,
  threadStore,
} from "./adapters";
import { createDesk, gatewayDeskModel } from "./assistant";
import { buildWorkflow } from "./build-workflow";
import { pgCaps } from "./caps";
import { env } from "./env";
import { createClientManagerMcp } from "./mcp";
import { verifyBearer } from "./mcp-auth";
import { modelEmbedder, modelPainter } from "./persona";
import type { BuildWorkflows, Later } from "./ports";
import { createBuildService } from "./services/builds";
import { createClientService } from "./services/clients";
import { createConnectService } from "./services/connect";
import { createGraphTools } from "./services/graph";
import { createThreadService } from "./services/threads";
import { noEmbedder, pixelPainter, scriptedDeskModel } from "./stubs";

/** Builds run as durable workflows; a stubbed request's Builds use the canned models. */
function workflows(stub: boolean): BuildWorkflows {
  return {
    async start(input) {
      const run = await start(buildWorkflow, [{ ...input, stub }]);
      return run.runId;
    },
    async cancel(workflowRunId) {
      await getRun(workflowRunId).cancel({
        cancelReason: "Stopped by the person",
      });
    },
    async announceStopped(workflowRunId) {
      const writer = getRun(workflowRunId)
        .getWritable<BuildEvent>()
        .getWriter();
      const at = Date.now();
      await writer.write({
        at,
        type: "log",
        level: "warn",
        text: "stopped by the person",
      });
      await writer.write({
        at,
        type: "end",
        status: "stopped",
        error: "Stopped",
      });
      writer.releaseLock();
    },
    events: (workflowRunId, from) =>
      getRun(workflowRunId).getReadable<BuildEvent>({ startIndex: from }),
  };
}

/** After the answer is sent; at once (unawaited) when there is no request to wait for. */
const later: Later = (work) => {
  const run = () =>
    work().catch((error) => {
      console.error("[client-manager] after the answer", error);
    });
  try {
    after(run);
  } catch {
    void run();
  }
};

/**
 * Client Manager's composition root for requests: the REST routes, the
 * pages and the MCP route share these services. `stub` (an e2e request
 * without `x-e2e-live: 1`) swaps every paid model for a script: the Desk's
 * chat model and web search, a search's embedding, the Portrait painter,
 * and the models of every Build it starts (`work-container.ts`). Gates,
 * caps, the MCP server, the workflows, Storage and the database stay real.
 */
export const clientManager = container(({ stub }) => {
  const builds = createBuildService({
    clients: clientStore,
    builds: buildStore,
    caps: pgCaps,
    files: bucket,
    workflows: workflows(stub),
    now: Date.now,
  });
  const clients = createClientService({
    clients: clientStore,
    files: bucket,
    caps: pgCaps,
    painter: stub ? pixelPainter : modelPainter,
    later,
    now: Date.now,
    halt: builds.haltLatest,
  });
  const graph = createGraphTools({
    graph: graphStore,
    catalog: clientStore.catalog,
    builds: buildStore,
    embedder: stub ? noEmbedder : modelEmbedder,
    addFacts: builds.addFacts,
  });
  const mcp = createClientManagerMcp(graph);
  const threads = createThreadService({
    threads: threadStore,
    clients: clientStore,
    caps: pgCaps,
    // The Desk speaks real MCP to this same server, without leaving the process.
    desk: createDesk({
      chat: stub ? scriptedDeskModel : gatewayDeskModel,
      mcp,
      cited: graphStore.cited,
    }),
    addFacts: builds.addFacts,
    now: Date.now,
  });
  const connect = createConnectService({
    secret: env.rateLimitSalt,
    now: Date.now,
    redeemCodeOnce,
    verify: verifyBearer,
  });
  return { builds, clients, threads, graph, connect, mcp };
});

export type ClientManagerServices = ReturnType<typeof clientManager>;
