/**
 * Uploads the rendered casework Cabinet to Supabase Storage and records its
 * case files, documents and labels. Idempotent: each case is replaced whole.
 *
 *   node fixtures/casework/render.mjs   # render first
 *   pnpm seed:casework
 *
 * Needs DATABASE_URL (the `casework` tables, reached directly) and
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Storage only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const ROOT = join(import.meta.dirname, "../fixtures/casework");
const OUT = join(ROOT, "out");
const BUCKET = "casework";
const SCENARIO_ORDER = [
  "pension_withdrawal",
  "employer_onboarding",
  "structure_review",
  "screening_review",
];

type ManifestDocument = {
  name: string;
  kind: string;
  label: Record<string, unknown>;
  file: string;
  mediaType: string;
  sourceFormat: string;
  pages: string[];
};
type ManifestCase = {
  slug: string;
  scenario: string;
  title: string;
  summary: string;
  asOf: string;
  expected: unknown;
  documents: ManifestDocument[];
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;
if (!url || !key || !databaseUrl)
  throw new Error(
    "Set DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
/** Storage only: the `casework` bucket. */
const storage = createClient(url, key, {
  auth: { persistSession: false },
}).storage;
// Supavisor (the transaction pooler): no prepared statements, one query at a time.
const sql = postgres(databaseUrl, {
  prepare: false,
  max_pipeline: 1,
  max: 1,
  onnotice: () => {},
});

const manifest: { cases: ManifestCase[] } = JSON.parse(
  readFileSync(join(OUT, "manifest.json"), "utf8"),
);
const splits: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "splits.json"), "utf8"),
);

const ordered = [...manifest.cases].sort(
  (a, b) =>
    SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario) ||
    a.slug.localeCompare(b.slug),
);

const contentType = (file: string) =>
  file.endsWith(".pdf")
    ? "application/pdf"
    : file.endsWith(".csv")
      ? "text/csv"
      : "image/jpeg";

/** Storage keys allow a narrow alphabet, so file names are slugged. */
const safe = (file: string) =>
  file
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-");

async function upload(path: string, file: string) {
  const body = readFileSync(file);
  const { error } = await storage
    .from(BUCKET)
    .upload(path, body, { contentType: contentType(file), upsert: true });
  if (error) throw new Error(`${path}: ${error.message}`);
}

async function pool<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<void>,
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item; item = queue.shift())
        await work(item);
    }),
  );
}

let documents = 0;
for (const [position, item] of ordered.entries()) {
  const folder = join(OUT, item.scenario, item.slug);
  const prefix = `cabinet/${item.scenario}/${item.slug}`;

  await sql`
    insert into casework.case_files
      (slug, scenario, title, summary, as_of, expected, split, position)
    values (
      ${item.slug}, ${item.scenario}, ${item.title}, ${item.summary},
      ${item.asOf}, ${sql.json(item.expected as never)},
      ${splits[item.slug] ?? "train"}, ${position}
    )
    on conflict (slug) do update set
      scenario = excluded.scenario,
      title = excluded.title,
      summary = excluded.summary,
      as_of = excluded.as_of,
      expected = excluded.expected,
      split = excluded.split,
      position = excluded.position`;
  await sql`delete from casework.documents where case_file_slug = ${item.slug}`;

  const files = [
    ...new Set(
      item.documents.flatMap((document) => [document.file, ...document.pages]),
    ),
  ];
  await pool(files, 6, (file) =>
    upload(`${prefix}/${safe(file)}`, join(folder, file)),
  );

  // One statement, as before: a Case file's Documents land together or not at all.
  if (item.documents.length > 0)
    await sql`
    insert into casework.documents ${sql(
      item.documents.map((document) => ({
        case_file_slug: item.slug,
        name: document.name,
        media_type: document.mediaType,
        source_format: document.sourceFormat,
        storage_path: `${prefix}/${safe(document.file)}`,
        page_paths: document.pages.map((page) => `${prefix}/${safe(page)}`),
        size_bytes: readFileSync(join(folder, document.file)).byteLength,
        label_kind: document.kind,
        label: sql.json(document.label as never),
      })),
    )}`;
  documents += item.documents.length;
  console.log(
    `✓ ${item.scenario}/${item.slug} (${item.documents.length}, ${splits[item.slug]})`,
  );
}

// Case files no longer in the manifest.
const existing = await sql<{ slug: string }[]>`
  select slug from casework.case_files`;
const stale = existing
  .map((row) => row.slug)
  .filter((slug) => !manifest.cases.some((item) => item.slug === slug));
if (stale.length > 0)
  await sql`delete from casework.case_files where slug = any(${stale}::text[])`;

console.log(`${ordered.length} case files, ${documents} documents seeded`);
await sql.end();
