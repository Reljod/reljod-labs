---
name: ship
description: Ship the current work in this repository - run the AGENTS.md check loop (touched vitest files, test, lint, typecheck, build), check migrations and paid-call rules, commit, push the branch and open or update a ready-for-review pull request. Use when the user types /ship or asks to ship, wrap up, or open a PR for the current change.
---

# /ship

Take the working tree from "done editing" to "pull request open", following the root `AGENTS.md`. Stop and report at the first step that fails; never skip a step to get green.

Arguments (optional): a short title for the change. Without one, derive it from the diff.

## 1. Know what is shipping

- `git status --short` and `git diff --stat` against the merge base with `origin/main` (`git merge-base HEAD origin/main`). Fetch `origin main` first.
- If you are on `main`, create a branch first (use the session's assigned branch when the harness gives one).
- List the demos touched (`src/features/<name>/`, `src/app/demos/<path>/`, `src/app/api/<name>/`) and confirm their `docs/demos/<name>.md` still matches the change. Update docs that describe changed behaviour.

## 2. Guardrails before running anything

- Never run `pnpm test:e2e`, `pnpm eval:*` or any `*_LIVE=1` switch unless the user asked for it in this conversation: they spend money and write to the live Supabase project. `e2e-changed` runs added or changed e2e tests on the pull request.
- Never apply migrations to the live project from here unless asked.
- New `.sql` migrations and sample `.pdf` files are dropped by a global gitignore: `git status --ignored supabase/migrations` and `git add -f` any new ones.
- Migrations must be additive so the deployed code keeps working. If the new code needs a migration applied first, say so in the pull request under a "Deploy order" heading.
- No secrets in the diff: scan it for keys, tokens, `.env*` files, service-role keys and `NEXT_PUBLIC_` secrets. Refuse to commit any.
- No em dash characters in prose you write (commit messages, PR body, docs): use a colon or a hyphen.
- If `next dev` rewrote the block between the `BEGIN:nextjs-agent-rules` markers in `AGENTS.md`, commit it with the work rather than reverting it.

## 3. Check loop

Run in order and stop on failure (fix, then rerun from the failed step):

```bash
pnpm exec vitest run <test files for the touched code>
```

```bash
pnpm test
```

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm build
```

If `pnpm lint` fails only on formatting, run `pnpm format` and rerun lint. If `node_modules` is missing, run `pnpm install --frozen-lockfile` first. Report each result with its pass/fail count; if a test fails, show the output and do not ship.

## 4. Commit

- Group the change into focused commits (one per concern when the diff mixes several). Message: imperative subject under 72 characters, prefixed with the area (`bank:`, `access:`, `ci:` ...), body explaining why.
- End every commit message with the attribution lines the harness gives for this session, if any.

## 5. Push and open the pull request

- `git push -u origin <branch>`; retry network failures up to 4 times with backoff. If the push is rejected because the remote has commits you lack, fetch and merge (never force-push someone else's work).
- If a pull request for the branch is already open, update its description instead of opening another.
- Otherwise open one, ready for review (not a draft), against `main`. Mirror the repository's PR template if one exists. Body headings:
  - **Summary**: what changed and why, by area.
  - **Deploy order**: migrations to apply before or after merge, env vars or GitHub/Vercel settings the owner must change. Omit when none.
  - **Testing**: the check-loop results from step 3, and which e2e tests `e2e-changed` will run (tests added or changed).
  - **Not done**: anything skipped and why.
- End the description with the attribution lines the harness gives for pull requests.
- Watch the pull request for CI and review activity when the harness offers a subscription, and say so.

## 6. Report

Give the user the pull request link, the commits, the check results, and anything they must do by hand (migrations, settings).
