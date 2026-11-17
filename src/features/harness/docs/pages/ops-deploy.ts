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

## 1. Apply the migration

The migration is §supabase/migrations/20261117120000_harness.sql§. It:

- creates the §vector§ extension if it is missing;
- creates the §harness§ schema and its tables, the search function and the Audit trigger;
- turns on row level security with no policies and revokes access from the Data API roles;
- registers §harness.workspaces§ in §access.owned_tables§;
- creates the private storage bucket §harness§ with a size cap;
- schedules a daily clean-up of old rate-limit rows, if §pg_cron§ is available.

Apply it with the Supabase CLI, or through the Supabase MCP tools when you ask for it.

## 2. Check the bucket

Open Storage and check that a private bucket named §harness§ exists. The app uploads to it with signed addresses. Its size cap should match the upload limit in [Limits](#doc:ref-limits).

## 3. Set the environment

Set the variables in [Environment variables](#doc:ref-env). The minimum is a database address and a gateway key, or the fallbacks the other demos already have. Leave the two Sandbox variables unset to leave the Sandbox off.

## 4. Check the Access gate

A new demo path must be in the proxy's matcher. §/demos/harness§ and §/api/harness/*§ should already be. A signed-out visitor should be turned away from both.

## 5. Run the checks

§§§bash
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
§§§

The end-to-end suite calls the paid model and writes to the live project. Run it only when you mean to.

## 6. After deploy

- Open §/demos/harness§ as a Host. The first visit seeds your Workspace.
- Send a message and check the Audit tab.
- Open the Connect page and check the connector URL shows your origin.
- If you set the Sandbox, see [Installing the Runner on the VPS](#doc:ops-runner) and try a Sandbox command as the admin.

## Rolling back

Code can be rolled back in Vercel. The migration is additive, so older code keeps working with it. To remove everything, drop the §harness§ schema and the bucket. That deletes every Workspace.
`,
  ],
};
