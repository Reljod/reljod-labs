import { createClient } from "@supabase/supabase-js";

/**
 * Deletes everything the suite created: Pre-screen runs (documents, spans and
 * findings cascade), Ask sessions (Builds cascade), and the e2e Owner's Rule
 * Versions and Audit trail. The suite's rows carry the e2e visitor hash and
 * the `e2e` Owner.
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
  // The e2e Owner's Rule edits and Audit trail, so every run starts at the
  // Default Rules. Deleting the trail row takes its append-only events by
  // cascade (ADR 0019).
  const compliance = createClient(url, key, {
    db: { schema: "document_compliance" },
    auth: { persistSession: false },
  });
  for (const table of ["rule_versions", "audit_trails"]) {
    const { error } = await compliance.from(table).delete().eq("owner", "e2e");
    if (error)
      throw new Error(`Could not delete e2e ${table}: ${error.message}`);
  }
}
