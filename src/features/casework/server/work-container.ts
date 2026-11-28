import "server-only";
import { container } from "@/platform/services/container";
import { cabinetStore, modelReader, runStore } from "./adapters";
import { documentLabels } from "./repository";
import { createRunWorkService } from "./services/work";
import { labelledReader } from "./stubs";

/**
 * The composition root of a Run's workflow steps (`run-workflow.ts`). Kept
 * apart from `container.ts`, which starts the workflow and so imports it, so
 * the steps never import the MCP server or the chat. A Run started by a
 * stubbed e2e request carries `ctx.stub`, and its steps read with the
 * labelled Reader instead of the models.
 */
export const runWork = container(({ stub }) =>
  createRunWorkService({
    runs: runStore,
    cabinet: cabinetStore,
    reader: stub ? labelledReader(documentLabels) : modelReader,
  }),
);
