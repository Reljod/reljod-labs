import "server-only";
import { container } from "@/platform/services/container";
import { modelPlanner } from "./planner";
import { buildRate } from "./rate-limit";
import {
  createAskSession,
  insertBuild,
  latestAnsweredSessionId,
  loadAskSession,
} from "./repository";
import { createLedgerService } from "./service";
import { cannedPlanner } from "./stub-plans";

/**
 * Ledger's composition root. Live: the model plans each Build. Stubbed (e2e
 * without `x-e2e-live: 1`): the canned Build plans of `stub-plans.ts`, run
 * through the same validation, storage, caps and stream.
 */
export const ledger = container(({ stub }) =>
  createLedgerService({
    sessions: {
      create: createAskSession,
      load: loadAskSession,
      insertBuild,
      latestAnswered: latestAnsweredSessionId,
    },
    rate: buildRate,
    planner: stub ? cannedPlanner : modelPlanner,
  }),
);
