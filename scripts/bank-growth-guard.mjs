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
 *   node scripts/bank-growth-guard.mjs [--content] <files.json>
 *   files.json: [{ "filename": "...", "status": "added|modified|removed|renamed", "previous_filename"?: "...", "patch"?: "..." }]
 *
 * With --content (CI and the merge routine) it also checks each file's
 * patch: no SQL naming a schema other than `bank`, no removed Owner
 * predicate, nothing that reads the environment (`contentFindings`).
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

/*
 * The content checks (`--content`): what a growth pull request's diff may
 * not do even inside the allowlist. They read the `patch` GitHub gives for
 * each file, never the pull request's checkout. A hit fails the check; the
 * merge routine (docs/routines/bank-merge.md, section 4) holds on the same
 * things. They are coarse on purpose: a false hit costs a person a look.
 */

/** The only schema a growth pull request's SQL may name. */
const OWN_SCHEMA = "bank";
/**
 * Every schema the app's migrations create, except the bank's. Kept by hand
 * because this script runs from a sparse checkout of the base branch; a test
 * (src/features/bank/domain/growth.test.ts) fails when a migration creates a
 * schema missing here.
 */
export const APP_SCHEMAS = [
  "access",
  "canvas",
  "casework",
  "client_manager",
  "document_compliance",
  "floorwalk",
  "harness",
  "helio",
  "ledger",
  "loupe",
  "name_extraction",
  "operator",
  "prism",
  "process_transfer",
  "switchboard",
  "vellum",
];
const PLATFORM_SCHEMAS = [
  "public",
  "auth",
  "storage",
  "vault",
  "cron",
  "net",
  "realtime",
  "graphql",
  "graphql_public",
  "extensions",
  "supabase_functions",
  "supabase_migrations",
  "pgsodium",
  "pg_catalog",
  "information_schema",
  "pg_temp",
  "pg_toast",
];
const SCHEMAS = [...APP_SCHEMAS, ...PLATFORM_SCHEMAS].join("|");
/**
 * Schemas whose name is also a common identifier in code (`access.kind`,
 * `storage.from`): in code they count only after a SQL keyword. The rest
 * (`client_manager.clients`) count anywhere.
 */
const AMBIGUOUS_IN_CODE = new Set([
  "access",
  "public",
  "auth",
  "storage",
  "vault",
  "cron",
  "net",
  "realtime",
  "extensions",
  "operator",
]);
const UNAMBIGUOUS = [...APP_SCHEMAS, ...PLATFORM_SCHEMAS]
  .filter((schema) => !AMBIGUOUS_IN_CODE.has(schema))
  .join("|");
/**
 * In a SQL file: a keyword followed by a schema-qualified relation or
 * function, across line breaks. (Not `on` or `to`: `on a.id = b.id` is an
 * alias.)
 */
const SQL_QUALIFIED =
  /\b(?:from|join|into|update|table|view|function|procedure|trigger|sequence|type|schema|references|truncate|exists|execute|call)\s+(?:only\s+)?"?([a-z_][a-z0-9_$]*)"?\s*\.\s*"?[a-z_*]/gi;
/** Schemas that are never the bank's, named anywhere in a SQL file. */
const FOREIGN_SCHEMA = new RegExp(
  `(?<![a-z0-9_.])"?(${SCHEMAS})"?\\s*\\.\\s*[a-z_"*]`,
  "gi",
);
/** In code: SQL (a query in a template) that names a schema that is never the bank's. */
const FOREIGN_SCHEMA_IN_CODE = new RegExp(
  `\\b(?:from|join|into|update|table|references|truncate|exists)\\s+"?(${SCHEMAS})"?\\s*\\.\\s*[a-z_"*]` +
    `|(?<![a-z0-9_.$])"?(${UNAMBIGUOUS})"?\\s*\\.\\s*[a-z_"*]`,
  "gi",
);
/** What a growth migration must be able to write: register its own table, harden a function. */
const ALLOWED_SQL = [
  /\binsert\s+into\s+access\s*\.\s*owned_tables\s*(?:\([^)]*\)\s*)?values\s*\(\s*'bank\.[a-z0-9_]+'\s*\)\s*(?:on\s+conflict\s+do\s+nothing)?/gi,
];
const SEARCH_PATH =
  /\bset\s+(?:local\s+|session\s+)?(?:search_path\b(?!\s*(?:=|to)\s*''(?=\s|;|,|$))|role\b)/i;
const CREATE_SCHEMA = /\bcreate\s+schema\b/i;
const OWNER_PREDICATE = /\bowner\s*(?:=|:)/gi;
const ENV_READ =
  /\bprocess\b|\bnode:process\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bDeno\s*\.\s*env\b|\bBun\s*\.\s*env\b|\b(?:from|import|require)\s*\(?\s*["'][^"']*\/env(?:\.[a-z]+)?["']/;
const ENV_FILE = /(^|\/)\.env(\.|$)|(^|\/)env\.(ts|tsx|js|mjs|cjs)$/;
const TEXT_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|sql|json|md|yml|yaml|sh)$/;

/** Added and removed lines of a GitHub `patch` (it has no file headers). */
function diffLines(patch) {
  const added = [];
  const removed = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

/** The added text with the allowed statements taken out. */
function addedText(added) {
  let text = added.join("\n");
  for (const allowed of ALLOWED_SQL) text = text.replace(allowed, "");
  return text;
}

const lineOf = (text, index) => {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? undefined : end).trim();
};

const count = (lines, pattern) =>
  lines.reduce((sum, line) => sum + (line.match(pattern)?.length ?? 0), 0);

/** The content of a pull request's diff that must not land unseen, each with why. */
export function contentFindings(files) {
  const out = [];
  for (const file of files) {
    const path = String(file.filename);
    const isSql = path.endsWith(".sql");
    for (const touched of [path, file.previous_filename].filter(Boolean)) {
      if (ENV_FILE.test(String(touched))) {
        out.push({ path, why: "touches an environment file" });
      }
    }
    if (typeof file.patch !== "string") {
      // GitHub leaves the patch out of large or binary files: a text file
      // that cannot be read cannot be checked, so it fails closed.
      if (file.status !== "removed" && TEXT_SOURCE.test(path)) {
        out.push({ path, why: "no diff to check (too large?)" });
      }
      continue;
    }
    const { added, removed } = diffLines(file.patch);
    for (const line of [...added, ...removed]) {
      if (ENV_READ.test(line)) {
        out.push({ path, why: `touches the environment: ${line.trim()}` });
      }
    }
    const text = addedText(added);
    if (isSql) {
      for (const match of text.matchAll(SQL_QUALIFIED)) {
        if (match[1].toLowerCase() !== OWN_SCHEMA) {
          out.push({
            path,
            why: `SQL names the schema "${match[1]}": ${lineOf(text, match.index)}`,
          });
        }
      }
    }
    // Prose (`docs/demos/casework.md`) is read by a person, never run.
    const foreign = path.endsWith(".md")
      ? []
      : text.matchAll(isSql ? FOREIGN_SCHEMA : FOREIGN_SCHEMA_IN_CODE);
    for (const match of foreign) {
      out.push({
        path,
        why: `SQL names another schema: ${lineOf(text, match.index)}`,
      });
    }
    for (const line of text.split("\n")) {
      if (SEARCH_PATH.test(line) || CREATE_SCHEMA.test(line)) {
        out.push({
          path,
          why: `SQL changes the schema or role: ${line.trim()}`,
        });
      }
    }
    const lost =
      count(removed, OWNER_PREDICATE) - count(added, OWNER_PREDICATE);
    if (lost > 0) {
      out.push({
        path,
        why: `removes ${lost} Owner predicate(s) (owner = / owner:)`,
      });
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("bank-growth-guard.mjs")) {
  const args = process.argv.slice(2);
  const content = args.includes("--content");
  const input = args.find((arg) => !arg.startsWith("--"));
  const files = JSON.parse(readFileSync(input, "utf8"));
  if (!Array.isArray(files)) {
    console.error("Expected a JSON list of changed files.");
    process.exit(2);
  }
  // 3000 is GitHub's cap on listed files: a larger pull request cannot be checked.
  if (files.length >= 3000) {
    console.error(
      "Too many files to check: a bank:growth pull request must be small.",
    );
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
  if (content) {
    const found = contentFindings(files);
    if (found.length > 0) {
      console.error(
        `A bank:growth pull request may not change other schemas, Owner predicates or the environment. ${found.length} finding(s):`,
      );
      for (const item of found) console.error(`  ${item.path}  (${item.why})`);
      process.exit(1);
    }
  }
  console.log(
    `bank:growth guard: ${files.length} file(s), all inside the allowlist${content ? ", no content findings" : ""}.`,
  );
}
