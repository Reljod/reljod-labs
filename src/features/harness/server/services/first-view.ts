import "server-only";
import { isAppError } from "@/platform/errors";
import {
  type FirstView,
  type ListRead,
  readsFor,
} from "../../domain/first-view";
import type { Place } from "../../domain/place";
import type { Actor } from "../ports";
import type { KnowledgeService } from "./knowledge";
import type { RuleService } from "./rules";
import type { RunService } from "./runs";
import type { SessionService } from "./sessions";
import type { SkillService } from "./skills";

/** A read's value, or undefined when it failed: the tab then reads it itself. */
async function settle<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch (error) {
    // A refusal (a Session that is not the reader's) is not a fault.
    if (!isAppError(error)) console.error("[harness] first view", error);
    return undefined;
  }
}

/**
 * The page's first view, read while it renders on the server through the
 * same services as the GET routes: every list the open tabs read when they
 * mount, and the open Session's messages, all started together. The gate
 * has already run; nothing here calls it again.
 */
export function createFirstView(services: {
  sessions: SessionService;
  runs: RunService;
  rules: RuleService;
  skills: SkillService;
  knowledge: KnowledgeService;
}) {
  const READERS: {
    [Read in ListRead]: (actor: Actor) => Promise<NonNullable<FirstView[Read]>>;
  } = {
    sessions: (actor) => services.sessions.list(actor),
    runs: (actor) => services.runs.list(actor),
    rules: (actor) => services.rules.list(actor),
    skills: (actor) => services.skills.list(actor),
    sources: (actor) => services.knowledge.sources(actor),
    conflicts: (actor) => services.knowledge.conflicts(actor),
  };

  return async function firstView(
    actor: Actor,
    place: Place,
  ): Promise<FirstView> {
    const sessionId = place.params.session ?? null;
    const read = <Read extends ListRead>(name: Read) =>
      settle<FirstView[Read]>(READERS[name](actor)).then((value) => ({
        [name]: value,
      }));
    const parts = await Promise.all([
      ...readsFor(place).map(read),
      sessionId
        ? settle(services.sessions.messages(actor, sessionId)).then(
            (messages) => ({
              messages: messages
                ? { sessionId: sessionId.toLowerCase(), messages }
                : undefined,
            }),
          )
        : {},
    ]);
    // A read that failed is undefined: dropped, so the tab reads it itself.
    return Object.fromEntries(
      Object.entries(Object.assign({}, ...parts)).filter(
        ([, value]) => value !== undefined,
      ),
    ) as FirstView;
  };
}
