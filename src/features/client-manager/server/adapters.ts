import "server-only";
import type {
  BuildGraphStore,
  BuildStore,
  ClientStore,
  Files,
  GraphStore,
  ThreadStore,
} from "./ports";
import * as repo from "./repository";
import * as storage from "./storage";

/** The Postgres adapters of the Client Manager ports, over `repository.ts`. */

export const clientStore: ClientStore = {
  get: repo.getClient,
  file: repo.clientFile,
  catalog: repo.listCatalog,
  create: repo.createClientRow,
  setStatus: repo.setClientStatus,
  setPortrait: repo.setPortrait,
  remove: repo.deleteClient,
  toPurge: repo.clientsToPurge,
  purge: repo.purgeClient,
  edges: repo.edgesInScope,
  node: repo.nodeDetail,
  source: repo.sourceDetail,
};

export const buildStore: BuildStore = {
  create: repo.createBuild,
  claim: repo.claimBuild,
  get: repo.getBuild,
  withClient: repo.buildWithClient,
  update: repo.updateBuild,
  latest: repo.latestBuild,
  createSources: repo.createSources,
  addMessage: repo.addMessage,
};

export const threadStore: ThreadStore = {
  create: repo.createThread,
  get: repo.getThread,
  list: repo.listThreads,
  update: repo.updateThread,
  remove: repo.deleteThread,
  addMessage: repo.addThreadMessage,
  messages: repo.threadMessages,
  history: repo.threadHistory,
  message: repo.getThreadMessage,
  decide: repo.decideProposal,
  setProposal: repo.setProposal,
};

export const graphStore: GraphStore = {
  categoryCounts: repo.categoryCounts,
  edgesInScope: repo.edgesInScope,
  searchAcross: repo.searchNodesAcross,
  nodesByKeys: repo.nodesByKeys,
  expandNodes: repo.expandNodes,
  edgesByIds: repo.edgesByIds,
  edgesAmong: repo.edgesAmong,
  connectNodes: repo.connectNodes,
  nodesInCategory: repo.nodesInCategory,
  evidenceForKeys: repo.evidenceForKeys,
  sources: repo.sourcesOfClient,
  factsPerSource: repo.factsPerSource,
  sourceDetail: repo.sourceDetail,
  usageSince: repo.usageSince,
  cited: repo.nodesByClientKeys,
};

export const buildGraphStore: BuildGraphStore = {
  client: repo.getClient,
  build: repo.getBuild,
  updateBuild: repo.updateBuild,
  sourcesOfBuild: repo.sourcesOfBuild,
  setSourceTexts: repo.setSourceTexts,
  loadGraph: repo.loadGraph,
  commitGraph: repo.commitGraph,
  recordRepairs: repo.recordRepairs,
  nodesWithoutEmbedding: repo.nodesWithoutEmbedding,
  setEmbeddings: repo.setEmbeddings,
  setPersona: repo.setPersona,
  setPortrait: repo.setPortrait,
  setClientStatus: repo.setClientStatus,
  buildSpend: repo.buildSpend,
  addMessage: repo.addMessage,
};

/** The private `client-manager` bucket. */
export const bucket: Files = {
  uploadUrl: storage.uploadUrl,
  upload: storage.upload,
  download: storage.download,
  signedUrl: (path) => storage.signedUrl(path),
  signedUrls: (paths) => storage.signedUrls(paths),
  sampleUrl: storage.sampleUrl,
  sampleUrls: storage.sampleUrls,
  removeFolder: storage.removeFolder,
  exists: storage.objectExists,
};
