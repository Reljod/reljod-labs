# 0033. Bank pull requests are merged by a routine that checks the fixes, not by the PR pipeline

Date: 2026-11-19. Status: accepted. Supersedes step 6 ("Merge") of `0024-the-bank-grows-itself-through-github.md`. Demo: Tidewater Bank (`src/features/bank`).

## Context

ADR 0024 left merging a growth pull request to the Hermes PR pipeline, which reviewed every pull request in a fresh session and merged it when no HIGH finding was left. That pipeline is now off for every repository. Reviewing moved to the "PR Code + Security Review" routine, which posts one review comment on each pull request when it opens and never merges. The build session that opened a growth pull request watches it, fixes what the review finds and pushes. Nothing merged the result.

## Decision

A third routine, `bank-merge` (`docs/routines/bank-merge.md`, created from that file and reading it from `main` on every run), merges a bank pull request when:

1. it stays inside the growth allowlist (`scripts/bank-growth-guard.mjs`), touches the bank, was opened by the owner's account, and is not labelled to hold;
2. the reviewer's label `review:passed` is on it and was given at the newest head (the review comment names that head);
3. CI is green on the head (`ci`, the growth guard, Vercel; `e2e-changed` skips growth pull requests, whose end-to-end tests run on `main` after the merge);
4. its own pattern checks on the whole diff find nothing (environment reads, network, processes, raw HTML or SQL, money written around `post()`, a removed gate or audit call, a skipped test, a migration).

Otherwise it waits or holds (`bank:held`, for Reljod), and says which on the pull request, once per head. It runs when a label is added and hourly as a sweep. It never pushes, approves or reviews.

The reviewer ("PR Code + Security Review") reviews on open and on every push, and records its result as a label, `review:passed` or `review:changes`, with the head it reviewed in its comment. The label is the hand-off: the reviewer judges, the merge routine only reads the status.

## Why this shape

- **The reviewer, the fixer and the merger are three sessions.** Nobody approves their own work: the builder fixes, a different session judges the fixes.
- **The status is a label, checked against the head.** A label alone could be stale after a push, so it counts only with a review comment that names the current head. The build session, the reviewer and this routine act as the same GitHub account, so a label or comment proves nothing about who wrote it: the merge routine's own pattern checks read neither, so a forged `review:passed` cannot merge a pull request that reaches for secrets, the network or the ledger.
- **Fail closed.** A missing review, a running check, a moved head or an ambiguous diff means wait or hold, never merge.

## Consequences

- Only pull requests that stay inside the bank are merged automatically. Everything else in the repository is merged by Reljod.
- A growth pull request merges without its end-to-end tests having run; `e2e.yml` runs the whole suite on `main` after the merge, and a failure there is fixed forward.
- A pull request whose review is clean merges within the hour (the sweep), one with fixes on the push that completes them.
