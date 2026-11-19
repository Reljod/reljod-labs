# 0024. The bank grows itself through GitHub, with the path rule enforced by code

Date: 2026-11-19. Status: accepted. Demo: Tidewater Bank (`src/features/bank`).

## Context

The headline of the bank demo is recursive improvement: a person asks the Teller for something the bank cannot do, or reports a bug, and the product changes with no human in the loop. That means untrusted text from a visitor ends up steering a coding agent with write access to the repository. The design has to make that safe by construction, not by hoping every model behaves.

## Decision

The loop is seven links, each owned by code or by an existing control:

1. **Raise.** The Teller calls the `raise_request` command (also in the app's Growth tab). Caps per Owner per day and while open are in `LIMITS`. The Growth Rule's blocked-topic check runs here, so a blocked request never queues.
2. **Triage, as a Workflow.** De-duplication against every open request (code), the Growth Rule again (code), then ONE model call that only classifies (in scope or not) and writes a spec. The visitor's words go to the model between `<<<UNTRUSTED` markers as data. The model's own output is run through the Growth Rule too. Code decides whether to go on.
3. **Issue.** A Workflow step files a GitHub issue (`bank:growth` plus `bank:feature` or `bank:bug`) written as a spec: problem, acceptance criteria, the allowed paths, and the visitor's words once, fenced and labelled untrusted (the fence cannot be closed from inside). The server needs `BANK_GITHUB_TOKEN` (fine-grained, Issues read/write on this repository only, Pull requests read to follow it). Without it a request stays "Triaged, waiting for a token" and the UI says so. A global cap limits issues per day.
4. **Build.** A Claude routine (a scheduled cloud agent; its prompt is checked in at `docs/routines/bank-growth.md`) takes the oldest open `bank:growth` issue with no pull request, implements the acceptance criteria on a `bank-growth/<n>-…` branch, runs the gates and opens a pull request that says `Closes #<n>` and carries the label. One issue per run.
5. **Guard.** `.github/workflows/bank-growth-guard.yml` runs on every pull request, decides by itself whether it is a growth pull request (the label, the routine's branch prefix, or a reference to an issue that carries `bank:growth`: a fact the routine cannot take back), and fails one that touches a path outside the allowlist: `src/features/bank/**`, `src/app/demos/bank/**`, `src/app/api/bank/**`, `e2e/bank.spec.ts`, `fixtures/bank/**`, `docs/adr/**`, and a NEW `supabase/migrations/*bank*.sql`. It runs on `pull_request_target`, from the base branch's copy of `scripts/bank-growth-guard.mjs`, on a file list from the API; it executes nothing from the pull request, and the guard, the workflow and the routine prompt are themselves outside the allowlist. The same list lives in `domain/growth.ts` for the issue text; `growth.test.ts` fails if the two differ.
6. **Merge.** Nothing new. The existing PR pipeline (`~/projects/jod-ops/pr-pipeline/POLICY.md`) reviews every pull request in this repository in a fresh session and merges when no HIGH is left. A growth pull request is an ordinary one to it. We did not add a second merger and did not weaken the policy.
7. **Close the loop.** The Growth Workflow keeps watching the issue (a durable sleep between looks) and the Growth tab re-reads GitHub at most every 45 seconds. A request moves Requested, Triaged, Issue, Pull request, Merged, Live. Live means the merge commit is in the running build (`VERCEL_GIT_COMMIT_SHA`, compared through the GitHub API). Then the Teller says so in the chat the request was raised in, and the Changelog gains an entry (the growth rings). An optional webhook (`/api/bank/github`, verified with `BANK_GITHUB_WEBHOOK_SECRET`) makes it immediate.

## Why this shape

- **The routine is the only actor that can be talked into something, so everything around it is code.** It may be fooled by an issue; it still cannot merge (the pipeline does), cannot touch auth, CI, secrets or another demo (the guard fails the pull request), and its output is reviewed by a different session against a policy that blocks on any HIGH.
- **The token that files issues cannot write code.** Issues read/write only. The routine uses its own GitHub connection.
- **Triage narrows, it never widens.** A request that names a blocked topic is refused by a regex before any model sees it; the model can only add a refusal.
- **Migrations by a growth pull request are additive files.** They are not applied automatically: a pull request whose feature needs a new table says so in its body, and the feature must degrade cleanly until Reljod applies it. The routine prompt tells the agent to prefer changes that need no migration.

## Consequences

- A growth pull request cannot add a dependency, a shared component, a landing-page entry or an `AGENTS.md` line. Features that need those are out of reach by design; triage refuses what it can tell is out of reach, and the guard stops the rest.
- What the bank learned is shown to every Owner (the Changelog), because code is shared. Only the title (already public on the issue) is shown, never who asked or what they typed.
- The loop costs one small model call per request plus a routine run per issue. `LIMITS.growthPerDay`, `growthOpenPerOwner` and `growthIssuesPerDay` bound it.
- "Live" needs `VERCEL_GIT_COMMIT_SHA`. A server without it (local dev) treats merged as live and says so.
