import "server-only";
import type {
  ApprovalStore,
  ManifestStore,
  RulebookStore,
  RunStore,
  TrailStore,
} from "./ports";
import {
  approvalRow,
  approvedFingerprints,
  claimClientCall,
  countHandRunsSince,
  countManifestsSince,
  createRun,
  currentRulebook,
  decideApprovalRow,
  endRunIfGoing,
  eventsAfter,
  expirePending,
  failManifest,
  getRunRow,
  insertApproval,
  insertEvents,
  insertManifest,
  insertRulebook,
  isOwnedRun,
  manifestsOf,
  moveRun,
  ownedManifest,
  ownedRun,
  pausedMsOf,
  releaseClientCall,
  rulebookVersions,
  runStatus,
  runsOf,
  saveManifestRead,
  setWorkflowRun,
  updateRun,
} from "./repository";

/** The `operator` schema in Postgres, as the services' ports (`repository.ts` holds the SQL). */

export const runStore: RunStore = {
  create: createRun,
  owned: ownedRun,
  owns: isOwnedRun,
  get: getRunRow,
  status: runStatus,
  list: runsOf,
  update: updateRun,
  setWorkflowRun,
  move: moveRun,
  endIfGoing: endRunIfGoing,
  countHandSince: countHandRunsSince,
  claimClientCall,
  releaseClientCall,
};

export const trailStore: TrailStore = {
  append: insertEvents,
  after: eventsAfter,
};

export const approvalStore: ApprovalStore = {
  insert: insertApproval,
  decide: decideApprovalRow,
  get: approvalRow,
  approvedFingerprints,
  expirePending,
  pausedMs: pausedMsOf,
};

export const rulebookStore: RulebookStore = {
  current: currentRulebook,
  versions: rulebookVersions,
  insert: insertRulebook,
};

export const manifestStore: ManifestStore = {
  countSince: countManifestsSince,
  insert: insertManifest,
  owned: ownedManifest,
  saveRead: saveManifestRead,
  fail: failManifest,
  list: manifestsOf,
};
