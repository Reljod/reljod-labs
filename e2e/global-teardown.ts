import { createClient } from "@supabase/supabase-js";

/**
 * Deletes every run the suite created; documents, spans and findings cascade.
 * Set `E2E_KEEP_RUNS=1` to keep them for debugging a failure in the database.
 */
export default async function globalTeardown() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.E2E_KEEP_RUNS === "1") return;
  const { error } = await createClient(url, key, {
    db: { schema: "document_compliance" },
    auth: { persistSession: false },
  })
    .from("prescreen_runs")
    .delete()
    .eq("visitor_hash", "e2e");
  if (error) throw new Error(`Could not delete e2e runs: ${error.message}`);
}
