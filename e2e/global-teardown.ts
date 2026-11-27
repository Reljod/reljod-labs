import postgres from "postgres";

/**
 * Deletes everything the suite created: Pre-screen runs (documents, spans and
 * findings cascade), Ask sessions (Builds cascade), and the e2e Owner's Rule
 * Versions and Audit trail. The suite's rows carry the e2e visitor hash and
 * the `e2e` Owner.
 * Set `E2E_KEEP_RUNS=1` to keep them for debugging a failure in the database.
 */
export default async function globalTeardown() {
  const url = process.env.DATABASE_URL;
  if (!url || process.env.E2E_KEEP_RUNS === "1") return;
  // Set up for Supabase's transaction pooler, as `src/server/postgres.ts` is.
  const sql = postgres(url, {
    prepare: false,
    max_pipeline: 1,
    max: 1,
    connect_timeout: 15,
    onnotice: () => {},
  });
  try {
    await deleteOrThrow(
      "prescreen_runs",
      sql`delete from document_compliance.prescreen_runs where visitor_hash = 'e2e'`,
    );
    await deleteOrThrow(
      "ask_sessions",
      sql`delete from ledger.ask_sessions where visitor_hash = 'e2e'`,
    );
    // The e2e Owner's Rule edits and Audit trail, so every run starts at the
    // Default Rules. Deleting the trail row takes its append-only events by
    // cascade (ADR 0019).
    await deleteOrThrow(
      "rule_versions",
      sql`delete from document_compliance.rule_versions where owner = 'e2e'`,
    );
    await deleteOrThrow(
      "audit_trails",
      sql`delete from document_compliance.audit_trails where owner = 'e2e'`,
    );
  } finally {
    await sql.end();
  }
}

async function deleteOrThrow(table: string, query: Promise<unknown>) {
  try {
    await query;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not delete e2e ${table}: ${message}`);
  }
}
