import "server-only";
import { adjudicateWithModel, decideWithModel } from "./jobs/judge";
import { readDocument } from "./jobs/read";
import { sortDocument } from "./jobs/sort";
import type {
  CabinetStore,
  CaseworkStorage,
  DeskStore,
  MessageStore,
  Reader,
  RunStore,
  SpendStore,
} from "./ports";
import {
  activeRuns,
  addMessage,
  asOfFor,
  candidateDocuments,
  closeStoppedRun,
  countUploads,
  createQuestion,
  createRun,
  createSession,
  documentsByIds,
  externalSession,
  getRun,
  getSession,
  insertUploads,
  loadCabinetDocuments,
  loadCaseFiles,
  loadMessages,
  loadSeedDocuments,
  loadUploads,
  markAnswered,
  openQuestions,
  openSessionOf,
  orgModelSettings,
  ownerSpendUsd,
  questionWithDesk,
  recordedUploadPaths,
  recordJobRun,
  runsForSession,
  runsWithCosts,
  sessionSpend,
  sessionsWithSpend,
  setModelOverrides,
  spendBySession,
  takeChatTurn,
  touchSession,
  updateRun,
} from "./repository";
import { signedUploadUrl, signedUrls, storedObject, textOf } from "./supabase";

/*
 * The live adapters both containers wire: the `casework` schema through the
 * repository's SQL, the private bucket through supabase-js Storage, and the
 * models a Run calls through the AI Gateway.
 */

export const deskStore: DeskStore = {
  create: createSession,
  get: getSession,
  openOf: openSessionOf,
  listWithSpend: sessionsWithSpend,
  touch: touchSession,
  setModelOverrides,
  orgModelSettings,
  external: externalSession,
};

export const cabinetStore: CabinetStore = {
  caseFiles: loadCaseFiles,
  seedDocuments: loadSeedDocuments,
  cabinetOf: loadCabinetDocuments,
  uploadsOf: loadUploads,
  byIds: documentsByIds,
  candidates: candidateDocuments,
  asOf: asOfFor,
  countUploads,
  recordedPaths: recordedUploadPaths,
  insertUploads,
};

export const runStore: RunStore = {
  create: createRun,
  get: getRun,
  update: updateRun,
  ofDesk: runsForSession,
  withCosts: runsWithCosts,
  active: activeRuns,
  closeStopped: closeStoppedRun,
  recordJob: recordJobRun,
  createQuestion,
  question: questionWithDesk,
  openQuestions,
  markAnswered,
};

export const messageStore: MessageStore = {
  add: addMessage,
  recent: loadMessages,
};

export const spendStore: SpendStore = {
  ofDesk: sessionSpend,
  byDesk: spendBySession,
  ofOwner: ownerSpendUsd,
  takeChatTurn,
};

export const bucket: CaseworkStorage = {
  signedUrls,
  signedUploadUrl,
  stored: storedObject,
  text: textOf,
};

/** The models behind Sort, Read, Adjudicate and Decide, through the AI Gateway. */
export const modelReader: Reader = {
  sort: sortDocument,
  read: readDocument,
  adjudicate: adjudicateWithModel,
  decide: decideWithModel,
};
