import "server-only";
import { unstable_rethrow } from "next/navigation";
import { type FirstView, type ListRead, readsFor } from "../domain/first-view";
import type { Place } from "../domain/place";
import type { StaffContext } from "./context";
import { listConflicts, listSources } from "./knowledge";
import { listRules } from "./rules";
import { listRuns } from "./runs";
import { listMessages, listSessions, readableSession } from "./sessions";
import { listSkills } from "./skills";

/** Each list read, as the matching GET route answers it, for the Owner the gate let in. */
const READERS: {
  [Read in ListRead]: (
    context: StaffContext,
  ) => Promise<NonNullable<FirstView[Read]>>;
} = {
  sessions: (context) => listSessions(context),
  runs: ({ owner }) => listRuns(owner),
  rules: ({ owner }) => listRules(owner),
  skills: ({ owner }) => listSkills(owner),
  sources: ({ owner }) => listSources(owner),
  conflicts: ({ owner }) => listConflicts(owner),
};

/** A read's value, or undefined when it failed: the tab then reads it itself. */
async function settle<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch (error) {
    // Next's own signals (the prerender bail-out, redirect) are not failures.
    unstable_rethrow(error);
    console.error("[harness] first view", error);
    return undefined;
  }
}

async function messagesOf(
  context: StaffContext,
  sessionId: string,
): Promise<FirstView["messages"]> {
  const [session, messages] = await Promise.all([
    readableSession(context, sessionId),
    listMessages(context.owner, sessionId),
  ]);
  return session ? { sessionId: session.id, messages } : undefined;
}

/**
 * The page's first view, read while it renders on the server: every list
 * the open tabs read when they mount, and the open Session's messages, all
 * started together. The gate has already run: the caller passes its context
 * and nothing here calls it again.
 */
export async function preloadFirstView(
  context: StaffContext,
  place: Place,
): Promise<FirstView> {
  const reads = readsFor(place);
  const sessionId = place.params.session ?? null;
  const read = <Read extends ListRead>(name: Read) =>
    settle<FirstView[Read]>(READERS[name](context)).then((value) => ({
      [name]: value,
    }));
  const parts = await Promise.all([
    ...reads.map(read),
    sessionId
      ? settle(messagesOf(context, sessionId)).then((messages) => ({
          messages,
        }))
      : {},
  ]);
  // A read that failed is undefined: dropped, so the tab reads it itself.
  return Object.fromEntries(
    Object.entries(Object.assign({}, ...parts)).filter(
      ([, value]) => value !== undefined,
    ),
  ) as FirstView;
}
