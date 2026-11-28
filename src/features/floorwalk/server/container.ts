import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { pgRateLimiter } from "@/platform/rate/limiter";
import { container } from "@/platform/services/container";
import { LIMITS } from "../domain/limits";
import { ask } from "./ask";
import { env } from "./env";
import type { SpendKind, Walker } from "./ports";
import { createFloorwalkService } from "./service";
import { download, sweepUploads, uploadUrl } from "./storage";
import { walk } from "./walker";

const rate = pgRateLimiter<SpendKind>({
  table: "floorwalk.rate_hits",
  caps: {
    walk: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.walksPerHour,
        message: `That's ${LIMITS.walksPerHour} Walks this hour. Replay a recorded one, or come back soon.`,
      },
      {
        scope: "everyone",
        window: "day",
        max: LIMITS.walksPerDay,
        message:
          "Floorwalk has walked all it may today. The recorded Walks still play.",
      },
    ],
    ask: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.asksPerHour,
        message: `That's ${LIMITS.asksPerHour} questions this hour. Try again soon.`,
      },
      {
        scope: "everyone",
        window: "day",
        max: LIMITS.asksPerDay,
        message: "Floorwalk has answered all it may today.",
      },
    ],
    upload: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.uploadsPerHour,
        message: `That's ${LIMITS.uploadsPerHour} uploads this hour.`,
      },
      {
        scope: "everyone",
        window: "day",
        max: LIMITS.uploadsPerDay,
        message: "No more uploads today.",
      },
    ],
  },
});

/** Gemini watching the footage. */
const modelWalker: Walker = {
  get model() {
    return env.model();
  },
  walk: (footage, signal) => walk(footage, { stub: false, signal }),
  ask: (footage, question, signal) =>
    ask(footage, question, { stub: false, signal }),
};

/** The scripted Walker of the e2e suite: the answer key's planted problems, no model call. */
const scriptedWalker: Walker = {
  get model() {
    return env.model();
  },
  walk: (footage, signal) => walk(footage, { stub: true, signal }),
  ask: (footage, question, signal) =>
    ask(footage, question, { stub: true, signal }),
};

/** Floorwalk's composition root: live adapters, or the scripted Walker for stubbed e2e requests. */
export const floorwalk = container(({ stub }) =>
  createFloorwalkService({
    store: { uploadUrl, download, sweep: sweepUploads },
    walker: stub ? scriptedWalker : modelWalker,
    rate,
    later: (work) => after(work),
    newId: randomUUID,
  }),
);
