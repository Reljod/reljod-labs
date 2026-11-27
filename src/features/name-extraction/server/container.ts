import "server-only";
import { randomUUID } from "node:crypto";
import { container } from "@/platform/services/container";
import {
  eventRepository,
  rulebookRepository,
  runRepository,
  runWorkflows,
  uploadRepository,
  uploadStore,
} from "./adapters";
import { loadDocument } from "./document";
import { env } from "./env";
import { createSieveMcpHandler } from "./mcp";
import { disposeSandbox } from "./sandbox";
import { createSieveServices } from "./services";
import { signSieveToken } from "./toolkit/mcp-token";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Sieve's composition root for requests: the REST routes, the page and the
 * MCP server share these services. `stub` (an e2e request without
 * `x-e2e-live: 1`) starts Runs that carry `ctx.stub`, so their workflow
 * steps play the Analyst and Readers from a script and start no Sandbox
 * (`work-container.ts`); a stopped stubbed Run has no Sandbox to stop. The
 * gates, caps, workflow, Storage and database are real in both.
 */
export const sieve = container(({ stub }) =>
  createSieveServices({
    runs: runRepository,
    events: eventRepository,
    rulebooks: rulebookRepository,
    uploads: uploadRepository,
    store: uploadStore,
    loadDocument,
    workflows: runWorkflows(stub),
    sandbox: { dispose: stub ? async () => {} : disposeSandbox },
    signToken: (claims) => signSieveToken(claims, env.rateLimitSalt()),
    stub,
    now: Date.now,
    newId: randomUUID,
    wait,
  }),
);

/** The MCP route's handler: a token minted by the stubbed suite reaches the stubbed services. */
export const mcpHandler = createSieveMcpHandler((stub) => sieve({ stub }));
