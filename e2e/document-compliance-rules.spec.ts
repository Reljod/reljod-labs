import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * Rules, re-evaluation, Reviewer decisions, the Pipeline view and the Audit
 * trail (ADR 0019), end to end against the live project. One real Pre-screen
 * of the stale-bill pack: its proof of address is too old under the Default
 * Rules and recent enough once the Rule allows 6 months.
 */

const DEMO = "/demos/document-compliance";
const RUN_TIMEOUT = 4 * 60 * 1000;
const RULE = "proof-of-address-recent";
const FINDING = `finding-${RULE}`;

function ruleCard(page: Page): Locator {
  return page.getByTestId(`rule-${RULE}`);
}

/** Puts the Rule back to its Default, if an earlier run left it edited. */
async function restoreDefault(page: Page) {
  await page.goto(`${DEMO}/rules`);
  const card = ruleCard(page);
  await expect(card).toBeVisible();
  if ((await card.getByTestId("rule-edited").count()) === 0) return;
  await card.getByTestId("rule-versions-toggle").click();
  await card.getByTestId("rule-version-0").getByTestId("rule-restore").click();
  await expect(card.getByTestId("rule-notice")).toContainText("Restored as");
  await expect(card.getByTestId("rule-edited")).toHaveCount(0);
}

async function openTab(page: Page, tab: string) {
  await page.getByTestId(`results-tab-${tab}`).click();
}

test("Rules, re-evaluation, Reviewer decisions, Pipeline and Audit trail", async ({
  page,
}) => {
  await restoreDefault(page);

  // A real Pre-screen under the Default Rules.
  await page.goto(DEMO);
  await page.getByTestId("pack-option-stale-bill").click();
  await page.getByTestId("run-prescreen").click();
  await page.waitForURL(/\/demos\/document-compliance\/runs\/[0-9a-f-]+$/);
  const runUrl = page.url();
  const report = page.getByTestId("findings-report");
  await expect(report).toHaveAttribute("data-run-status", "completed", {
    timeout: RUN_TIMEOUT,
  });
  await expect(page.getByTestId(FINDING)).toHaveAttribute(
    "data-outcome",
    "fail",
  );
  await expect(page.getByTestId("evaluation-1")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // A Reviewer confirms the Fail, with a note.
  const review = page.getByTestId(`review-${RULE}`);
  await review.getByTestId("review-open").click();
  await expect(review.getByTestId("review-save")).toBeDisabled();
  await review.getByText("Confirm Fail").click();
  await review
    .getByTestId("review-note")
    .fill("Bill is from June; ask for a newer one.");
  await review.getByTestId("review-save").click();
  await expect(review.getByTestId("review-decision")).toHaveAttribute(
    "data-outcome",
    "fail",
  );
  await expect(review.getByTestId("review-decision")).toContainText(
    "Bill is from June",
  );

  // The Pipeline: a lane per Document joining at Evaluate; only Read is the model.
  await openTab(page, "pipeline");
  const pipeline = page.getByTestId("pipeline-view");
  await expect(pipeline).toBeVisible();
  for (const kind of [
    "identity_document",
    "proof_of_address",
    "certified_copy",
  ]) {
    for (const stage of ["parse", "read", "verify", "check"]) {
      await expect(
        page.getByTestId(`pipeline-node-${kind}-${stage}`),
      ).toHaveAttribute("data-state", "done");
    }
  }
  await page.getByTestId("pipeline-node-proof_of_address-read").click();
  await expect(page.getByTestId("pipeline-detail")).toContainText(
    "Tokens in / out",
  );
  await page.getByTestId("pipeline-node-evaluate").click();
  await expect(page.getByTestId("pipeline-detail")).toContainText(`${RULE} v0`);

  // The run's Audit trail: start, three reads with their cost, finish, review.
  await openTab(page, "audit");
  await expect(page.getByTestId("audit-event").first()).toBeVisible();
  await expect(
    page.locator('[data-testid="audit-event"][data-action="run.started"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-testid="audit-event"][data-action="document.read"]'),
  ).toHaveCount(3);
  await expect(
    page.locator('[data-testid="audit-event"][data-action="run.finished"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-testid="audit-event"][data-action="finding.reviewed"]'),
  ).toHaveCount(1);
  await expect(
    page
      .locator('[data-testid="audit-event"][data-action="document.read"]')
      .first(),
  ).toContainText("out");

  // Edit the Rule: a bad value is refused where it is typed, a good one saved.
  await page.goto(`${DEMO}/rules`);
  const card = ruleCard(page);
  const months = card.getByTestId("rule-param-maxAgeMonths");
  await months.fill("13");
  await expect(card.getByRole("alert")).toContainText("from 1 to 12");
  await expect(card.getByTestId("rule-save")).toBeDisabled();
  await months.fill("6");
  await card.getByTestId("rule-save").click();
  await expect(card.getByTestId("rule-notice")).toContainText(
    "Saved as Version",
  );
  await expect(card.getByTestId("rule-edited")).toBeVisible();

  // Re-evaluate the run with the edited Rule: no model call, the Finding moves.
  await page.goto(runUrl);
  await expect(report).toHaveAttribute("data-run-status", "completed");
  await page.getByTestId("reevaluate").click();
  await expect(page.getByTestId("reevaluate-notice")).toContainText(
    "Saved as Evaluation 2",
  );
  await expect(page.getByTestId(FINDING)).toHaveAttribute(
    "data-outcome",
    "pass",
  );
  await expect(page.getByTestId("evaluation-changes")).toContainText(
    "Fail → Pass",
  );
  await expect(page.getByTestId(FINDING)).toContainText("within 6 months");

  // The same Rules again change nothing, so they are refused.
  await page.getByTestId("reevaluate").click();
  await expect(page.getByTestId("reevaluate-notice")).toContainText(
    "Evaluation 2 applied",
  );

  // Evaluation 1 still shows its Fail and the decision made on it, read-only.
  await page.getByTestId("evaluation-1").click();
  await expect(page.getByTestId(FINDING)).toHaveAttribute(
    "data-outcome",
    "fail",
  );
  await expect(review.getByTestId("review-decision")).toBeVisible();
  await expect(review.getByTestId("review-open")).toHaveCount(0);

  // The Owner's whole Audit trail has the Rule change and the re-evaluation.
  await page.goto(`${DEMO}/audit`);
  await expect(page.getByTestId("audit-trail")).toBeVisible();
  for (const action of [
    "rule.saved",
    "run.reevaluated",
    "finding.reviewed",
    "run.started",
  ]) {
    await expect(
      page
        .locator(`[data-testid="audit-event"][data-action="${action}"]`)
        .first(),
    ).toBeVisible();
  }
  await page.getByTestId("audit-filter-action").selectOption("rule.saved");
  await expect(
    page.locator('[data-testid="audit-event"]:not([data-action="rule.saved"])'),
  ).toHaveCount(0);

  // Back to the Default, as a restore: a new Version, audited.
  await restoreDefault(page);
});
