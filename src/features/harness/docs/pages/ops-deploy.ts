import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-deploy",
  section: "operations",
  title: "Deploying",
  summary:
    "The migration, the storage bucket, the environment and the checks, in order.",
  body: [
    md`
## Before you start

You need the Supabase project and the Vercel project the other demos use. Apply changes to the live project only when you mean to. Additive changes go first and stay safe for the code already deployed.

## 1. Apply the migrations

Four migrations in §supabase/migrations/§, applied in this order. Each is additive, so the code already deployed keeps working while you apply them.

1. §20261117120000_harness.sql§: the foundation. It creates the §vector§ extension if it is missing; creates the §harness§ schema with its tables, the search function and the Audit trigger; turns on row level security with no policies and revokes access from the Data API roles; registers §harness.workspaces§ in §access.owned_tables§; creates the private storage bucket §harness§ with a 10 MB cap; and schedules a daily clean-up of old rate-limit rows if §pg_cron§ is available.
2. §20261117130000_harness_pipelines.sql§: one nullable column the contribution checks need, §harness.members.started_work_on§.
3. §20261117150000_harness_knowledge.sql§: the columns that let a Source be attached first and read later (the cached text, the number of reads tried, when a read began) and one partial unique index.
4. §20261117160000_harness_search_rate.sql§: what the hourly cap on Knowledge searches needs (see [Limits](#doc:ref-limits)).

Apply them with the Supabase CLI, or through the Supabase MCP tools when you ask for it. The §harness§ schema does not need to be listed under Exposed schemas: the app reaches it over a direct Postgres connection, not the Data API.

The migrations and the sample files under §public/harness/samples/§ (PDF, XLSX, CSV, text) are added to git with §git add -f§, because a global gitignore on the author's machine would otherwise leave them out. Check that a fresh clone has all four migrations and every sample.

## 2. Check the bucket

The base migration creates the private bucket §harness§. Open Storage and check that it exists and is private. The app uploads to it with signed addresses. Its size cap should match the upload limit in [Limits](#doc:ref-limits).

## 3. Set the environment

Set the variables in [Environment variables](#doc:ref-env). The minimum is a database address, a gateway key, §SUPABASE_URL§, §SUPABASE_SERVICE_ROLE_KEY§ and §RATE_LIMIT_SALT§, using the fallbacks the other demos already have for the first two. Leave the two Sandbox variables unset to leave the Sandbox off. If you set them, §HARNESS_SANDBOX_URL§ must be https (or http on a loopback host, for local development); anything else leaves the Sandbox off.

## 4. Check the Access gate

A new demo path must be in the proxy's matcher. §/demos/harness§ and §/api/harness/*§ should already be. A signed-out visitor should be turned away from both.

## 5. Run the checks

§§§bash
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
§§§

The end-to-end spec for this demo is §e2e/harness.spec.ts§. It is skipped unless §E2E_HARNESS=1§ is set. The chat turn is stubbed, so no model is called, but it writes to the project's §e2e§ Workspace and uploads a sample to Storage: run it only when you mean to, once the migrations are applied.

## 6. After deploy

- Open §/demos/harness§ as a Host. The first visit seeds your Workspace, which takes a few seconds.
- Send a message and check the Audit tab.
- Open the Connect page and check the connector URL shows your origin.
- If you set the Sandbox, see [Installing the Runner on the VPS](#doc:ops-runner) and try a Sandbox command as the admin.

## Rolling back

Code can be rolled back in Vercel. The migration is additive, so older code keeps working with it. To remove everything, drop the §harness§ schema and delete the §harness§ bucket. That deletes every Workspace.
`,
  ],
};
