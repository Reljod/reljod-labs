/**
 * Uploads the rendered casework Cabinet to Supabase Storage and records its
 * case files, documents and labels. Idempotent: each case is replaced whole.
 *
 *   node fixtures/casework/render.mjs   # render first
 *   pnpm seed:casework
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
if (!url || !key)
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(url, key, {
  db: { schema: "casework" },
  auth: { persistSession: false },
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
  const { error } = await db.storage
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

  const { error: caseError } = await db.from("case_files").upsert({
    slug: item.slug,
    scenario: item.scenario,
    title: item.title,
    summary: item.summary,
    as_of: item.asOf,
    expected: item.expected,
    split: splits[item.slug] ?? "train",
    position,
  });
  if (caseError) throw new Error(caseError.message);
  const { error: deleteError } = await db
    .from("documents")
    .delete()
    .eq("case_file_slug", item.slug);
  if (deleteError) throw new Error(deleteError.message);

  const files = [
    ...new Set(
      item.documents.flatMap((document) => [document.file, ...document.pages]),
    ),
  ];
  await pool(files, 6, (file) =>
    upload(`${prefix}/${safe(file)}`, join(folder, file)),
  );

  const { error } = await db.from("documents").insert(
    item.documents.map((document) => ({
      case_file_slug: item.slug,
      name: document.name,
      media_type: document.mediaType,
      source_format: document.sourceFormat,
      storage_path: `${prefix}/${safe(document.file)}`,
      page_paths: document.pages.map((page) => `${prefix}/${safe(page)}`),
      size_bytes: readFileSync(join(folder, document.file)).byteLength,
      label_kind: document.kind,
      label: document.label,
    })),
  );
  if (error) throw new Error(error.message);
  documents += item.documents.length;
  console.log(
    `✓ ${item.scenario}/${item.slug} (${item.documents.length}, ${splits[item.slug]})`,
  );
}

// Case files no longer in the manifest.
const { data: existing } = await db.from("case_files").select("slug");
const stale = (existing ?? [])
  .map((row: { slug: string }) => row.slug)
  .filter((slug: string) => !manifest.cases.some((item) => item.slug === slug));
if (stale.length > 0) await db.from("case_files").delete().in("slug", stale);

console.log(`${ordered.length} case files, ${documents} documents seeded`);
