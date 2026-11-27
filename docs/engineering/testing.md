# Testing and CI

The short version is in the root `AGENTS.md` ("Your check loop"). Read this before you change a workflow in `.github/workflows/`, `scripts/e2e-select.mjs`, `playwright.config.ts`, or add an opt-in e2e suite.

Keep every check loop fast. A pull request's CI, an agent's own verification and a review session never run the whole end-to-end suite; only the merge to `main` does.

## Pull request CI

Fast, and never a required check for e2e.

- `.github/workflows/ci.yml` runs `test`, `lint` and `typecheck` in parallel, with no secrets and no build (the Vercel preview builds the pull request).
- `.github/workflows/e2e-changed.yml` runs only the end-to-end tests the pull request adds or changes (`scripts/e2e-select.mjs`: a test is picked when the diff touches its lines; the whole spec runs when the spec is serial or the change can reach several tests, such as a `test.use`, a hook or a line above the first test) against a production build, keeping its rows (`E2E_KEEP_RUNS=1`; the run on `main` cleans up).
- It runs the pull request's code with the app's secrets, so it is opt-in, per commit, by a person:
  - only a branch of this repository by the owner or a collaborator, never a Bank Growth pull request (`scripts/growth-pr.sh`, shared with the growth guard: the label, a `bank-growth/` branch, or a `bank:growth` issue it closes; their tests run after the merge);
  - only after a person applies the `e2e:run` label. At its start the job re-reads the pull request from the API and refuses unless the label is still on it, its most recent `labeled` event was by a human account (not a bot) listed in the `E2E_LABELERS` repository variable (space-separated logins; default: the repository owner), and the head is still the labelled commit. Every push removes the label (job `unlabel`), so each new commit needs a new label;
  - only after the `e2e` environment's required reviewer approves the waiting job in the Actions tab. The label, the branch and the closing issue are all chosen by whoever wrote the pull request, including an agent working from visitor text; the label's actor and the reviewer are not.
- On other events the check only lists the changed tests in its summary. So a change worth an end-to-end test carries the test in the same pull request, and the owner labels it once the code is reviewed.

## After the merge

Asynchronous, never in front of a deployment. `.github/workflows/e2e.yml` runs the whole suite on every push to `main`, beside the Vercel production deployment; only the newest commit is tested. A failure there is fixed forward in a new pull request. Run it by hand from the Actions tab for another branch.

## Secrets in the e2e workflows

- Both e2e workflows read the app's environment from one secret, `E2E_ENV` (the contents of `.env.local`, kept by hand: most of the app's variables are Vercel Secrets, which `vercel env pull` cannot read). It is an environment secret, never a repository secret: a repository secret is readable by a workflow on any branch a collaborator (or an agent with push access) pushes.
  - `e2e` (required reviewer): `e2e-changed.yml`, and `e2e.yml` run by hand on a branch other than `main`.
  - `e2e-main` (deployment branches: `main` only, no reviewer): `e2e.yml` on every push to `main`.
- Each value of 6 or more characters is masked in the logs, `.env.local` is written only right before the tests (actions are pinned to commit SHAs), and neither workflow uploads a report or uses a dependency cache: on a public repository an artifact is readable by anyone, and a Playwright trace records the bypass header.
- They turn on the opt-in suites (`E2E_BANK`, `E2E_CANVAS`, `E2E_HARNESS`, `E2E_OPERATOR`, `E2E_PRISM`, `E2E_SWITCHBOARD`) and leave every `*_LIVE` switch off. A new opt-in suite adds its switch to both.
- In CI the suite runs against a production build (`next start`); locally against `next dev` unless `E2E_SERVER=prod`.

## One-time setup for the e2e secret

The owner does this once in the repository's Settings (an agent cannot):

1. **Environments → New environment `e2e`.** Turn on "Required reviewers" and add yourself; turn on "Prevent self-review" only if another person can approve. Leave "Deployment branches" at all branches (a `pull_request_target` run deploys from `main` anyway; a hand run of `e2e.yml` on another branch also lands here). Add the environment secret `E2E_ENV` with the contents of `.env.local`.
2. **Environments → New environment `e2e-main`.** No reviewer; "Deployment branches and tags": selected branches, `main` only. Add the same `E2E_ENV` secret.
3. **Secrets and variables → Actions → Repository secrets:** delete the repository-level `E2E_ENV` once both environments have it.
4. **Labels → New label `e2e:run`** ("run this commit's changed e2e tests with the app's secrets").
5. Optional: **Variables → `E2E_LABELERS`**, a space-separated list of the logins allowed to apply `e2e:run` (default: the repository owner). Never list the account a routine or agent pushes or labels with.

To run a pull request's changed tests: review its code, add `e2e:run`, then approve the `e2e` deployment the run waits on.
