# Testing and CI

The short version is in the root `AGENTS.md` ("Your check loop"). Read this before you change a workflow in `.github/workflows/`, `scripts/e2e-select.mjs`, `playwright.config.ts`, or add an opt-in e2e suite.

Keep every check loop fast. A pull request's CI, an agent's own verification and a review session never run the whole end-to-end suite; only the merge to `main` does.

## Pull request CI

Fast, and never a required check for e2e.

- `.github/workflows/ci.yml` runs `test`, `lint` and `typecheck` in parallel, with no secrets and no build (the Vercel preview builds the pull request).
- `.github/workflows/e2e-changed.yml` runs only the end-to-end tests the pull request adds or changes (`scripts/e2e-select.mjs`: a test is picked when the diff touches its lines; the whole spec runs when the spec is serial or the change can reach several tests, such as a `test.use`, a hook or a line above the first test) against a production build, keeping its rows (`E2E_KEEP_RUNS=1`; the run on `main` cleans up).
- It runs the pull request's code with the app's secrets, so only for code a person wrote: a branch of this repository by the owner or a collaborator, never a Bank Growth pull request (`scripts/growth-pr.sh`, shared with the growth guard: the label, a `bank-growth/` branch, or a `bank:growth` issue it closes; their tests run after the merge). So a change worth an end-to-end test carries the test in the same pull request.

## After the merge

Asynchronous, never in front of a deployment. `.github/workflows/e2e.yml` runs the whole suite on every push to `main`, beside the Vercel production deployment; only the newest commit is tested. A failure there is fixed forward in a new pull request. Run it by hand from the Actions tab for another branch.

## Secrets in the e2e workflows

- Both e2e workflows read the app's environment from one repository secret, `E2E_ENV` (the contents of `.env.local`, kept by hand: most of the app's variables are Vercel Secrets, which `vercel env pull` cannot read).
- Each value of 6 or more characters is masked in the logs, `.env.local` is written only right before the tests (actions are pinned to commit SHAs), and neither workflow uploads a report or uses a dependency cache: on a public repository an artifact is readable by anyone, and a Playwright trace records the bypass header.
- They turn on the opt-in suites (`E2E_BANK`, `E2E_CANVAS`, `E2E_HARNESS`, `E2E_OPERATOR`, `E2E_PRISM`, `E2E_SWITCHBOARD`) and leave every `*_LIVE` switch off. A new opt-in suite adds its switch to both.
- In CI the suite runs against a production build (`next start`); locally against `next dev` unless `E2E_SERVER=prod`.
