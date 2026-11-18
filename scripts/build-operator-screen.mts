/**
 * Rebuilds the Screen process bundle the Operator demo writes into each
 * Run's sandbox. Run it after changing anything under
 * `src/features/operator/legacy/`, `domain/guard.ts`, `domain/rule-kinds.ts`,
 * `domain/iso6346.ts` or `server/sandbox/`; `screen-bundle.test.ts` fails
 * when the committed bundle is stale.
 */
import { writeFileSync } from "node:fs";
import {
  buildScreenBundle,
  bundleHash,
  generatedModule,
} from "../src/features/operator/server/sandbox/build.ts";

const code = await buildScreenBundle();
const target = new URL(
  "../src/features/operator/server/sandbox/screen-bundle.generated.ts",
  import.meta.url,
);
writeFileSync(target, generatedModule(code));
console.log(
  `screen bundle: ${(code.length / 1024).toFixed(1)} KB, hash ${bundleHash(code)}`,
);
