#!/usr/bin/env node
/**
 * The Growth guard: fails a pull request labelled `bank:growth` that touches
 * a path outside the bank demo. The routine that opens those pull requests
 * is told the same list (docs/routines/bank-growth.md); this is the list
 * enforced by code, so the rule does not depend on the routine behaving.
 *
 * Run by .github/workflows/bank-growth-guard.yml from the BASE branch's copy
 * of this file (never the pull request's), with the changed files read from
 * the GitHub API. It executes nothing from the pull request.
 *
 *   node scripts/bank-growth-guard.mjs <files.json>
 *   files.json: [{ "filename": "...", "status": "added|modified|removed|renamed", "previous_filename"?: "..." }]
 *
 * Keep ALLOWED_* identical to src/features/bank/domain/growth.ts
 * (growth.test.ts fails if they differ). This file is deliberately outside
 * the allowlist: a growth pull request cannot change its own guard.
 */
import { readFileSync } from "node:fs";

export const ALLOWED_PREFIXES = [
  "src/features/bank/",
  "src/app/demos/bank/",
  "src/app/api/bank/",
  "fixtures/bank/",
  "docs/adr/",
];
export const ALLOWED_FILES = ["e2e/bank.spec.ts"];
export const ALLOWED_NEW_MIGRATION =
  /^supabase\/migrations\/\d{14}_[a-z0-9_]*bank[a-z0-9_]*\.sql$/;

/** The files outside the allowlist, each with why. */
export function outsideAllowlist(files) {
  const out = [];
  const check = (path, status) => {
    if (typeof path !== "string" || path.includes("..")) {
      out.push({ path: String(path), why: "not a plain path" });
    } else if (ALLOWED_NEW_MIGRATION.test(path)) {
      if (status !== "added") {
        out.push({ path, why: "a migration may only be added, never changed" });
      }
    } else if (
      !ALLOWED_FILES.includes(path) &&
      !ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
    ) {
      out.push({ path, why: "outside the bank demo" });
    }
  };
  for (const file of files) {
    check(file.filename, file.status);
    // A rename touches the path it came from too.
    if (file.previous_filename) check(file.previous_filename, "renamed");
  }
  return out;
}

if (process.argv[1]?.endsWith("bank-growth-guard.mjs")) {
  const files = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (!Array.isArray(files)) {
    console.error("Expected a JSON list of changed files.");
    process.exit(2);
  }
  // 3000 is GitHub's cap on listed files: a larger pull request cannot be checked.
  if (files.length >= 3000) {
    console.error("Too many files to check: a bank:growth pull request must be small.");
    process.exit(1);
  }
  const outside = outsideAllowlist(files);
  if (outside.length > 0) {
    console.error(
      `A pull request labelled bank:growth may only touch the bank demo. ${outside.length} file(s) are outside the allowlist:`,
    );
    for (const item of outside) console.error(`  ${item.path}  (${item.why})`);
    process.exit(1);
  }
  console.log(`bank:growth guard: ${files.length} file(s), all inside the allowlist.`);
}
