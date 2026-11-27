import "server-only";
import type {
  AccessLookup,
  ApprovalStore,
  FrameStore,
  ManifestFiles,
  ManifestStore,
  RulebookStore,
  RunStore,
  RunWorkflow,
  ScreenPort,
  TrailStore,
} from "../ports";
import { type ClientTokenService, createClientTokenService } from "./clients";
import { createManifestService, type ManifestService } from "./manifests";
import { createRulebookService, type RulebookService } from "./rulebooks";
import { createRunsService, type RunsService } from "./runs";
import type { RunStepsService } from "./steps";

export type { Caller } from "./runs";

/** Everything the Operator does, by area. The routes, the MCP server and the page call these. */
export type OperatorServices = {
  runs: RunsService;
  rulebooks: RulebookService;
  manifests: ManifestService;
  clients: ClientTokenService;
};

export type OperatorPorts = {
  runs: RunStore;
  trail: TrailStore;
  approvals: ApprovalStore;
  rulebooks: RulebookStore;
  manifests: ManifestStore;
  manifestFiles: ManifestFiles;
  frames: FrameStore;
  screen: ScreenPort;
  workflow: RunWorkflow;
  steps: RunStepsService;
  access: AccessLookup;
  stub: boolean;
  now: () => number;
};

export function createOperatorServices(ports: OperatorPorts): OperatorServices {
  return {
    runs: createRunsService(ports),
    rulebooks: createRulebookService(ports.rulebooks),
    manifests: createManifestService({
      manifests: ports.manifests,
      files: ports.manifestFiles,
      now: ports.now,
    }),
    clients: createClientTokenService({ access: ports.access, now: ports.now }),
  };
}
