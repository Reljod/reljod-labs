import { expect, type Page, test } from "@playwright/test";
import { packs } from "../src/features/document-compliance/packs";

/** Set by `pnpm test:e2e:record`: slow down at each flagged Finding so videos show the evidence. */
const recording = process.env.E2E_RECORD === "1";

const DEMO = "/demos/document-compliance";
// Generous: three parses plus three model calls, on a cold parser.
const RUN_TIMEOUT = 4 * 60 * 1000;

/** The field each flawed pack's scan should stamp, as soon as its Document is read. */
const PLANTED: Partial<Record<string, { field: string; outcome: string }>> = {
  "expired-passport": { field: "date_of_expiry", outcome: "fail" },
  "stale-bill": { field: "statement_date", outcome: "fail" },
  "name-mismatch": { field: "full_name", outcome: "needs_review" },
  "tampered-passport": { field: "date_of_expiry", outcome: "needs_review" },
};

async function expectFindingsReport(page: Page) {
  const report = page.getByTestId("findings-report");
  await expect(report).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(report).toHaveAttribute("data-run-status", "completed");
}

async function runPrescreen(page: Page, slug: string) {
  await page.goto(DEMO);
  await page.getByTestId(`pack-option-${slug}`).click();
  await expect(page.getByTestId("pack-preview")).toBeVisible();
  await page.getByTestId("run-prescreen").click();

  await page.waitForURL(/\/demos\/document-compliance\/runs\/[0-9a-f-]+$/);
  await expect(page.getByTestId("scan-stage")).toBeVisible();
  // Fields fly in as the model reads them, then get their Field check stamp.
  await expect(page.getByTestId("field-chip").first()).toBeVisible({
    timeout: RUN_TIMEOUT,
  });
  const planted = PLANTED[slug];
  if (planted) {
    await expect
      .soft(
        page.locator(
          `[data-testid="field-chip"][data-field-name="${planted.field}"][data-outcome="${planted.outcome}"]`,
        ),
      )
      .not.toHaveCount(0, { timeout: RUN_TIMEOUT });
  }
  await expect(page.getByTestId("terminal")).toContainText("parse");

  await expectFindingsReport(page);
  await expect(page.getByTestId("run-notice")).toHaveCount(0);
  await expect(page.getByTestId("terminal")).toContainText(
    "pre-screen complete",
  );
}

const compact = (text: string) => text.replace(/\s+/g, "").toLowerCase();

/** Every value shown as Evidence must be boxed on the page and found in the boxed text. */
async function expectEvidenceTraceable(page: Page) {
  let boxesSeen = 0;
  const findings = page.locator('[data-testid^="finding-"]');
  for (let index = 0; index < (await findings.count()); index++) {
    await findings.nth(index).click();
    const fields = page.getByTestId("evidence-field");
    for (
      let fieldIndex = 0;
      fieldIndex < (await fields.count());
      fieldIndex++
    ) {
      const field = fields.nth(fieldIndex);
      const value = (await field.getAttribute("data-field-value")) ?? "";
      const refs = ((await field.getAttribute("data-span-refs")) ?? "")
        .split(" ")
        .filter(Boolean);
      expect(refs.length, `"${value}" cites no spans`).toBeGreaterThan(0);

      const boxedText: string[] = [];
      for (const ref of refs) {
        const box = page.locator(
          `[data-testid="evidence-box"][data-span-ref="${ref}"]`,
        );
        await expect(box, `no box drawn for span ${ref}`).toHaveCount(1);
        boxedText.push((await box.getAttribute("data-span-text")) ?? "");
        boxesSeen++;
      }
      for (const word of value.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
        expect(
          compact(boxedText.join(" ")),
          `"${value}" is not in its boxed source text`,
        ).toContain(word.toLowerCase());
      }
    }
  }
  expect(boxesSeen, "no evidence box was drawn at all").toBeGreaterThan(0);
}

for (const pack of packs) {
  test(`${pack.slug}: Findings match the pack's expected outcomes`, async ({
    page,
  }) => {
    await runPrescreen(page, pack.slug);

    for (const { requirementId, outcome } of pack.expectedFindings) {
      await expect
        .soft(page.getByTestId(`finding-${requirementId}`))
        .toHaveAttribute("data-outcome", outcome);
    }

    if (pack.slug === "clean") {
      await test.step("every Finding traces back to boxes on its source", () =>
        expectEvidenceTraceable(page));

      await test.step("a stored run replays its scan, then its Findings", async () => {
        await page.goto(`${page.url()}?replay=1`);
        await expect(page.getByTestId("scan-stage")).toBeVisible();
        await expect(page.getByTestId("field-chip").first()).toBeVisible();
        await expectFindingsReport(page);
        for (const { requirementId, outcome } of pack.expectedFindings) {
          await expect
            .soft(page.getByTestId(`finding-${requirementId}`))
            .toHaveAttribute("data-outcome", outcome);
        }
      });
    }

    // Open each flagged Finding so its Evidence is on screen (and in recordings).
    for (const { requirementId, outcome } of pack.expectedFindings) {
      if (outcome === "pass") continue;
      const finding = page.getByTestId(`finding-${requirementId}`);
      await finding.click();
      await expect(finding).toHaveAttribute("aria-pressed", "true");
      if (recording) {
        await page
          .getByRole("tablist", { name: "Documents" })
          .evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(3000);
      }
    }
  });
}
