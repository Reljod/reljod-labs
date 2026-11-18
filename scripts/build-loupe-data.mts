/**
 * Packs what Loupe's server needs from files it cannot read at run time on
 * Vercel into two generated JSON modules:
 *
 * - `src/features/loupe/server/toolkit.generated.json`: the Python Toolkit
 *   (`src/features/loupe/toolkit/loupe/**`) and its requirements, written
 *   into every Sandbox. `requirementsHash` names the Sandbox snapshot that
 *   holds the installed packages.
 * - `src/features/loupe/domain/corpus.generated.json`: the Manifest, the
 *   recorded Sweep of every Corpus Document, and for each featured Sample
 *   its file's SHA-256, page sizes and Evidence layer files.
 *
 *   node --experimental-strip-types scripts/build-loupe-data.mts
 *
 * `pnpm render:loupe-corpus` runs it after rendering. Deterministic:
 * re-running changes nothing. `toolkit-contract.test.ts` fails when either
 * file is stale.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TOOLKIT = join(ROOT, "src/features/loupe/toolkit");
const FIXTURES = join(ROOT, "fixtures/loupe");
const SAMPLES = join(ROOT, "public/loupe/samples");

const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out.sort();
}

export async function toolkitBundle() {
  const requirements = (
    await readFile(join(TOOLKIT, "requirements.txt"), "utf8")
  ).trim();
  const files: Record<string, string> = {};
  for (const path of await walk(join(TOOLKIT, "loupe"))) {
    if (!path.endsWith(".py")) continue;
    files[relative(TOOLKIT, path).replaceAll("\\", "/")] = await readFile(
      path,
      "utf8",
    );
  }
  let readme = "";
  try {
    readme = await readFile(join(TOOLKIT, "README.md"), "utf8");
  } catch {
    // Optional.
  }
  return {
    requirements,
    requirementsHash: sha(requirements).slice(0, 16),
    hash: sha(JSON.stringify(files)).slice(0, 16),
    readme,
    files,
  };
}

type Entry = { id: string; featured?: boolean; file: string };

export async function corpusBundle() {
  const manifest = JSON.parse(
    await readFile(join(FIXTURES, "manifest.json"), "utf8"),
  ) as { documents: Entry[] };
  const sweeps: { id: string; measurements: unknown[] }[] = [];
  const samples: Record<
    string,
    {
      file: string;
      sha256: string;
      bytes: number;
      pages: { page: number; width: number; height: number }[];
      layers: string[];
    }
  > = {};
  for (const entry of manifest.documents) {
    const expected = JSON.parse(
      await readFile(join(FIXTURES, "expected", `${entry.id}.json`), "utf8"),
    ) as {
      measurements: unknown[];
      pages: { page: number; width: number; height: number }[];
    };
    sweeps.push({ id: entry.id, measurements: expected.measurements });
    if (!entry.featured) continue;
    const dir = join(SAMPLES, entry.id);
    const names = (await readdir(dir)).sort();
    const file = names.find((name) => name.startsWith("document."));
    if (!file) throw new Error(`${entry.id}: no document file in ${dir}`);
    const bytes = await readFile(join(dir, file));
    samples[entry.id] = {
      file,
      sha256: sha(bytes),
      bytes: (await stat(join(dir, file))).size,
      pages: expected.pages,
      layers: names.filter((name) => name.endsWith(".png")),
    };
  }
  return { entries: manifest.documents, sweeps, samples };
}

const write = (path: string, value: unknown) =>
  writeFile(join(ROOT, path), `${JSON.stringify(value)}\n`);

if (import.meta.main) {
  const toolkit = await toolkitBundle();
  await write("src/features/loupe/server/toolkit.generated.json", toolkit);
  console.log(
    `toolkit: ${Object.keys(toolkit.files).length} files, hash ${toolkit.hash}, requirements ${toolkit.requirementsHash}`,
  );
  const corpus = await corpusBundle();
  await write("src/features/loupe/domain/corpus.generated.json", corpus);
  console.log(
    `corpus: ${corpus.entries.length} Documents, ${Object.keys(corpus.samples).length} Samples`,
  );
}
