/**
 * Re-renders the Loupe Corpus: the Documents and the Manifest
 * (fixtures/loupe/corpus, manifest.json), the recorded Sweep of each
 * (fixtures/loupe/expected), the featured Samples (public/loupe/samples) and
 * the tuning report (fixtures/loupe/tuning.json). Python does the work, under
 * uv with the Toolkit's pinned requirements; nothing is installed globally.
 *
 *   node --experimental-strip-types scripts/render-loupe-corpus.mts
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIREMENTS = "src/features/loupe/toolkit/requirements.txt";

for (const step of ["build.py", "record.py", "tune.py"]) {
  const result = spawnSync(
    "uv",
    [
      "run",
      "--quiet",
      "--python",
      "3.14",
      "--with-requirements",
      REQUIREMENTS,
      "python",
      join("fixtures/loupe/generate", step),
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        PYTHONPATH: join(ROOT, "src/features/loupe/toolkit"),
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONWARNINGS: "ignore",
      },
    },
  );
  if (result.status !== 0) {
    console.error(`render-loupe-corpus: ${step} failed`);
    process.exit(result.status ?? 1);
  }
}
