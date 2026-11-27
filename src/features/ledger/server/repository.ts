import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { jsonb } from "@/server/postgres";
import type { AskSessionView, StoredBuild } from "../domain/build-events";
import { type BuildPlan, finalizePlan } from "../domain/build-plan";
import { sql } from "./db";

type BuildRow = {
  id: string;
  position: number;
  question: string;
  build_plan: BuildPlan;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Re-validated on read, so a source the site no longer shows is never replayed. */
const toBuild = (row: BuildRow): StoredBuild => ({
  id: row.id,
  position: row.position,
  question: row.question,
  plan: finalizePlan(row.build_plan),
  createdAt: row.created_at,
});

/** Run a query, naming what failed the way the callers' logs always have. */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${what}: ${message}`, { cause: error });
  }
}

export async function createAskSession(input: {
  visitorHash: string;
  owner: Owner;
}) {
  const [row] = await attempt(
    "Could not create an Ask session",
    () => sql()<{ id: string }[]>`
      insert into ledger.ask_sessions (visitor_hash, owner)
      values (${input.visitorHash}, ${input.owner})
      returning id`,
  );
  if (!row) throw new Error("Could not create an Ask session: no row");
  return row.id;
}

/** An Owner's Ask session; null when it is missing or someone else's. */
export async function loadAskSession(
  id: string,
  owner: Owner,
): Promise<AskSessionView | null> {
  if (!UUID.test(id)) return null;
  const [row] = await attempt(
    `Could not load Ask session ${id}`,
    () => sql()<{ id: string; builds: BuildRow[] }[]>`
      select s.id,
        coalesce(
          (select json_agg(
              json_build_object(
                'id', b.id,
                'position', b.position,
                'question', b.question,
                'build_plan', b.build_plan,
                'created_at', b.created_at
              )
              order by b.position
            )
            from ledger.builds b
            where b.ask_session_id = s.id),
          '[]'::json
        ) as builds
      from ledger.ask_sessions s
      where s.id = ${id}::uuid and s.owner = ${owner}`,
  );
  if (!row) return null;
  return { id: row.id, builds: row.builds.map(toBuild) };
}

export async function insertBuild(input: {
  askSessionId: string;
  question: string;
  plan: BuildPlan;
  model: string;
  visitorHash: string;
}): Promise<StoredBuild> {
  const db = sql();
  // The next position is the session's Build count; `unique (ask_session_id,
  // position)` refuses a second Build racing for the same one.
  const [row] = await attempt(
    "Could not store the Build",
    () => db<BuildRow[]>`
      insert into ledger.builds
        (ask_session_id, position, question, build_plan, model, visitor_hash)
      select ${input.askSessionId}::uuid, count(*)::int, ${input.question}::text,
        ${jsonb(db, input.plan)}::jsonb, ${input.model}::text,
        ${input.visitorHash}::text
      from ledger.builds
      where ask_session_id = ${input.askSessionId}::uuid
      returning id, position, question, build_plan, created_at`,
  );
  if (!row) throw new Error("Could not store the Build: no row");
  return toBuild(row);
}

/**
 * The Owner's newest Ask session that has an answer to show: where a limited
 * visitor lands. Null when they have none.
 */
export async function latestAnsweredSessionId(owner: Owner) {
  const [row] = await attempt(
    "Could not find a stored session",
    () => sql()<{ ask_session_id: string }[]>`
      select b.ask_session_id
      from ledger.builds b
      join ledger.ask_sessions s on s.id = b.ask_session_id
      where s.owner = ${owner}
      order by b.created_at desc
      limit 1`,
  );
  return row?.ask_session_id ?? null;
}
