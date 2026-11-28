import "server-only";
import { getWritable } from "workflow";
import { container } from "@/platform/services/container";
import type { BuildEvent } from "../domain/events";
import { bucket, buildGraphStore } from "./adapters";
import { modelCritic } from "./critic";
import { modelExtractor } from "./extract";
import { readSource } from "./gather";
import { modelEmbedder, modelPainter, modelPersona } from "./persona";
import type { BuildEmitter } from "./ports";
import { createBuildWork } from "./services/build-work";
import {
  cannedExtractor,
  cannedPersona,
  cleanCritic,
  noEmbedder,
  pixelPainter,
} from "./stubs";

/** The Build's event stream: the writable of the workflow run this step belongs to. */
const runEvents: BuildEmitter = {
  async emit(...events) {
    const writer = getWritable<BuildEvent>().getWriter();
    try {
      for (const event of events) {
        await writer.write({ ...event, at: Date.now() } as BuildEvent);
      }
    } finally {
      writer.releaseLock();
    }
  },
  close: () => getWritable().close(),
};

/**
 * The composition root of a Build's workflow steps (`build-workflow.ts`).
 * Kept apart from `container.ts`, which starts the workflow and so imports
 * it. A Build started by a stubbed e2e request carries `stub`, and its steps
 * use the canned extractor, Critic, Persona and Portrait and no embeddings;
 * Storage, the database and the workflow stay real.
 */
export const buildWork = container(({ stub }) =>
  createBuildWork({
    store: buildGraphStore,
    read: readSource,
    extractor: stub ? cannedExtractor : modelExtractor,
    critic: stub ? cleanCritic : modelCritic,
    persona: stub ? cannedPersona : modelPersona,
    painter: stub ? pixelPainter : modelPainter,
    embedder: stub ? noEmbedder : modelEmbedder,
    files: bucket,
    events: runEvents,
    now: Date.now,
  }),
);
