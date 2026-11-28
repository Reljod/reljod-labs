import "server-only";
import { getRun, start } from "workflow/api";
import { container } from "@/platform/services/container";
import { auditLog } from "./audit";
import { modelReader } from "./extract";
import { parseDocument } from "./parsers";
import type { PrescreenWorkflow } from "./ports";
import { prescreenWorkflow } from "./prescreen-workflow";
import { runRepository } from "./repository";
import { ruleRepository } from "./rules";
import { scriptedReader } from "./scripted-reader";
import { createAuditService } from "./services/audit";
import { createPacksService } from "./services/packs";
import { createPrescreenService } from "./services/prescreen";
import { createRulesService } from "./services/rules";
import { createRunsService } from "./services/runs";
import { download, signedUrl } from "./supabase";

/** A ReadableStream as an async iterable, closed when the consumer stops early. */
async function* iterate<T>(stream: ReadableStream<T>): AsyncGenerator<T> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * The durable Pre-screen workflow. A stubbed run says so in its input, so
 * its steps (which run outside any request) pick the scripted reader too.
 */
function workflowOf(stub: boolean): PrescreenWorkflow {
  return {
    async start(input) {
      const run = await start(prescreenWorkflow, [{ ...input, stub }]);
      return run.runId;
    },
    events: (workflowRunId, from) =>
      iterate(getRun(workflowRunId).getReadable({ startIndex: from })),
  };
}

const packStore = { download, signedUrl };

/**
 * Document compliance's composition root. Live, the model behind the AI
 * Gateway reads each Document; stubbed (the e2e suite without
 * `x-e2e-live: 1`) the scripted reader does, and everything else (the gate,
 * the caps, the parser, Storage, the database and the workflow) stays real.
 */
export const documentCompliance = container(({ stub }) => {
  const reader = stub ? scriptedReader : modelReader;
  const rules = createRulesService({ rules: ruleRepository });
  return {
    runs: createRunsService({
      runs: runRepository,
      audit: auditLog,
      workflow: workflowOf(stub),
      rules,
      model: reader.model,
    }),
    rules,
    audit: createAuditService({ audit: auditLog }),
    packs: createPacksService({ packs: packStore }),
    prescreen: createPrescreenService({
      runs: runRepository,
      audit: auditLog,
      packs: packStore,
      parser: { parse: parseDocument },
      reader,
      logLost: (action, error) =>
        console.error(`[document-compliance] audit ${action} lost`, error),
    }),
  };
});

export type DocumentComplianceServices = ReturnType<typeof documentCompliance>;
