import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { type Cap, pgRateLimiter } from "@/platform/rate/limiter";
import { container } from "@/platform/services/container";
import { LIMITS } from "../domain/limits";
import { bankToday } from "../domain/pipelines/dates";
import { auditLog, auditRepository } from "./audit";
import { modelAgent, stubAgent } from "./chat";
import { env } from "./env";
import { checkForConflicts } from "./knowledge/conflict-check";
import { gatewayEmbedder, noEmbedder } from "./knowledge/embeddings";
import { knowledgeRepository } from "./knowledge/repository";
import { removeFile, signedDownloadUrl, uploadUrl } from "./knowledge/storage";
import { sourceTexts } from "./knowledge/text";
import { mcpHandler } from "./mcp";
import { sourcesOf } from "./pipelines/source-file";
import { runRepository } from "./pipelines/store";
import type { HarnessRate, Later, SpendKind } from "./ports";
import * as records from "./records";
import { ruleRepository } from "./rules";
import { stubSandboxes, vercelSandboxes } from "./sandbox";
import { createHarnessServices, type HarnessServices } from "./services";
import { sessionRepository } from "./sessions";
import { skillRepository } from "./skills";
import { listStaff, ownedStaff } from "./staff";
import { workflowSdk } from "./workflows";
import { ensureWorkspace, forgetWorkspace } from "./workspace";

const hourly = (max: number, what: string): Cap[] => [
  {
    scope: "visitor",
    window: "hour",
    max,
    message: `That's ${max} ${what} this hour. Try again soon.`,
  },
];

/** The hourly caps in `LIMITS`, per visitor (AGENTS.md: rate limits stay on the visitor hash). */
const rate: HarnessRate = pgRateLimiter<SpendKind>({
  table: "harness.rate_hits",
  owner: true,
  caps: {
    message: hourly(LIMITS.messagesPerHour, "messages"),
    run: hourly(LIMITS.runsPerHour, "Runs"),
    source: hourly(LIMITS.sourcesPerHour, "Sources"),
    search: hourly(LIMITS.searchesPerHour, "searches"),
    sandbox_command: hourly(LIMITS.sandboxCommandsPerHour, "Sandbox commands"),
  },
});

/** After the answer is sent; run now (unawaited) when there is no request to wait for. */
const later: Later = (work) => {
  const run = () =>
    work().catch((error) => {
      console.error("[harness] after the answer", error);
    });
  try {
    after(run);
  } catch {
    void run();
  }
};

/**
 * Harness's composition root. Live: the model gateway, Vercel Sandbox and
 * the embedding model. Stubbed (e2e without `x-e2e-live: 1`): the canned
 * Agent that calls one MCP tool in process, Runs whose model Steps use their
 * fallbacks, the Conflict check's stub verdicts, no embeddings and an
 * in-memory Sandbox. Gates, caps, the database, Storage and the Workflow
 * SDK are real in both.
 */
export const harness = container(({ stub }): HarnessServices => {
  const services = createHarnessServices({
    workspace: {
      ensure: ensureWorkspace,
      forget: forgetWorkspace,
      staff: listStaff,
      ownedStaff,
    },
    sessions: sessionRepository,
    runs: runRepository,
    runSources: { meta: sourcesOf },
    rules: ruleRepository,
    skills: skillRepository,
    knowledge: knowledgeRepository,
    records,
    trail: auditRepository,
    audit: auditLog,
    rate,
    texts: sourceTexts,
    files: { uploadUrl, signedUrl: signedDownloadUrl, remove: removeFile },
    embedder: stub ? noEmbedder : gatewayEmbedder,
    conflicts: {
      check: (input) => checkForConflicts({ ...input, stubbed: stub }),
    },
    sandboxes: stub ? stubSandboxes() : vercelSandboxes,
    workflows: workflowSdk,
    agent: (rest) => {
      const deps = {
        skills: rest.skills,
        attachments: rest.sessions.attachments,
        audit: auditLog,
        // The Harness MCP server, in process, on these same services.
        mcp: (request: Request) => mcpHandler(request, rest),
      };
      return stub ? stubAgent(deps) : modelAgent(deps);
    },
    later,
    newId: randomUUID,
    now: Date.now,
    today: bankToday,
    secret: env.rateLimitSalt,
    stubSteps: stub,
  });
  return services;
});
