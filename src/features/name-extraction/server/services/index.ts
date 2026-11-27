import type { Owner } from "@/features/access/domain/owner";
import type { RulebookVersion, RunSummary } from "../../domain/contract";
import type { SievePorts } from "../ports";
import { type ConnectService, createConnectService } from "./connect";
import { createPreviewService, type PreviewService } from "./preview";
import { createRulebookService, type RulebookService } from "./rulebooks";
import { createRunService, type RunService } from "./runs";
import { createUploadService, type UploadService } from "./uploads";

/** What the page's first view needs; a part that fails is null, and the client says so. */
export type FirstView = {
  runs: RunSummary[] | null;
  rulebooks: RulebookVersion[] | null;
};

export type SieveServices = {
  runs: RunService;
  rulebooks: RulebookService;
  uploads: UploadService;
  preview: PreviewService;
  connect: ConnectService;
  /** The Owner's Runs and Rulebook versions, read together. */
  firstView(owner: Owner): Promise<FirstView>;
};

/** Every Sieve service over one set of ports: the REST routes, the MCP server and the page share them. */
export function createSieveServices(ports: SievePorts): SieveServices {
  const runs = createRunService(ports);
  const rulebooks = createRulebookService(ports);
  return {
    runs,
    rulebooks,
    uploads: createUploadService(ports),
    preview: createPreviewService(ports),
    connect: createConnectService(ports),
    async firstView(owner) {
      const [listed, versions] = await Promise.allSettled([
        runs.list(owner),
        rulebooks.versions(owner),
      ]);
      return {
        runs: listed.status === "fulfilled" ? listed.value : null,
        rulebooks: versions.status === "fulfilled" ? versions.value : null,
      };
    },
  };
}
