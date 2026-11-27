import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { AskSessionView, StoredBuild } from "../domain/build-events";
import { type BuildPlan, finalizePlan } from "../domain/build-plan";
import { supabase } from "./supabase";

type BuildRow = {
  id: string;
  position: number;
  question: string;
  build_plan: BuildPlan;
  created_at: string;
};

const BUILD_COLUMNS = "id, position, question, build_plan, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Re-validated on read, so a source the site no longer shows is never replayed. */
const toBuild = (row: BuildRow): StoredBuild => ({
  id: row.id,
  position: row.position,
  question: row.question,
  plan: finalizePlan(row.build_plan),
  createdAt: row.created_at,
});

export async function createAskSession(input: {
  visitorHash: string;
  owner: Owner;
}) {
  const { data, error } = await supabase()
    .from("ask_sessions")
    .insert({ visitor_hash: input.visitorHash, owner: input.owner })
    .select("id")
    .single();
  if (error)
    throw new Error(`Could not create an Ask session: ${error.message}`);
  return data.id as string;
}

/** An Owner's Ask session; null when it is missing or someone else's. */
export async function loadAskSession(
  id: string,
  owner: Owner,
): Promise<AskSessionView | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase()
    .from("ask_sessions")
    .select(`id, builds (${BUILD_COLUMNS})`)
    .eq("id", id)
    .eq("owner", owner)
    .order("position", { referencedTable: "builds" })
    .maybeSingle();
  if (error)
    throw new Error(`Could not load Ask session ${id}: ${error.message}`);
  if (!data) return null;
  return { id: data.id, builds: (data.builds as BuildRow[]).map(toBuild) };
}

export async function insertBuild(input: {
  askSessionId: string;
  question: string;
  plan: BuildPlan;
  model: string;
  visitorHash: string;
}): Promise<StoredBuild> {
  const { count, error: countError } = await supabase()
    .from("builds")
    .select("id", { count: "exact", head: true })
    .eq("ask_session_id", input.askSessionId);
  if (countError)
    throw new Error(`Could not count Builds: ${countError.message}`);
  const { data, error } = await supabase()
    .from("builds")
    .insert({
      ask_session_id: input.askSessionId,
      position: count ?? 0,
      question: input.question,
      build_plan: input.plan,
      model: input.model,
      visitor_hash: input.visitorHash,
    })
    .select(BUILD_COLUMNS)
    .single();
  if (error) throw new Error(`Could not store the Build: ${error.message}`);
  return toBuild(data as BuildRow);
}

/**
 * The Owner's newest Ask session that has an answer to show: where a limited
 * visitor lands. Null when they have none.
 */
export async function latestAnsweredSessionId(owner: Owner) {
  const { data, error } = await supabase()
    .from("builds")
    .select("ask_session_id, ask_sessions!inner(owner)")
    .eq("ask_sessions.owner", owner)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`Could not find a stored session: ${error.message}`);
  return (data?.ask_session_id as string | undefined) ?? null;
}
