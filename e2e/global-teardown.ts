import { createClient } from "@supabase/supabase-js";

/**
 * Deletes everything the suite created: Pre-screen runs (documents, spans and
 * findings cascade) and Ask sessions (Builds cascade).
 * Set `E2E_KEEP_RUNS=1` to keep them for debugging a failure in the database.
 */
export default async function globalTeardown() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.E2E_KEEP_RUNS === "1") return;
  const targets = [
    { schema: "document_compliance", table: "prescreen_runs" },
    { schema: "ledger", table: "ask_sessions" },
  ];
  for (const { schema, table } of targets) {
    const { error } = await createClient(url, key, {
      db: { schema },
      auth: { persistSession: false },
    })
      .from(table)
      .delete()
      .eq("visitor_hash", "e2e");
    if (error)
      throw new Error(`Could not delete e2e ${table}: ${error.message}`);
  }
}
