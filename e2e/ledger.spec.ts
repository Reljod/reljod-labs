import { expect, type Locator, type Page, test } from "@playwright/test";
import { PRESET_QUESTIONS } from "../src/features/ledger/domain/presets";

/*
 * Ledger: ask from his demo page, watch him rebuild the About page into an answer.
 * Stubbed by default: canned Build plans run through the real validation,
 * storage and stream. `E2E_LEDGER_LIVE=1` asks the real model instead and
 * skips the scenarios that need a specific plan.
 */
const live = process.env.E2E_LEDGER_LIVE === "1";
const BUILD_TIMEOUT = live ? 150_000 : 90_000;
const STUB_INVENTED = "stub: invented excerpt";
const STUB_TOSS = "stub: toss";

test.describe.configure({ mode: "serial" });
test.setTimeout(live ? 300_000 : 180_000);
test.use({
  extraHTTPHeaders: {
    "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "",
    ...(live ? {} : { "x-ledger-stub": "1" }),
  },
});

/** Records every pose Ledger takes on the session page, so tests can check what he did. */
async function recordPoses(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __poses: string[] }).__poses = seen;
    new MutationObserver(() => {
      const pose = document
        .querySelector('[data-testid="ask-screen"] [data-testid="ledger-cat"]')
        ?.getAttribute("data-pose");
      if (pose && seen.at(-1) !== pose) seen.push(pose);
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-pose"],
    });
  });
}

const poses = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __poses: string[] }).__poses ?? [],
  );

const screen = (page: Page) => page.getByTestId("ask-screen");

/** Asks from the Ledger demo's chat box and waits for the session page to open. */
async function askFromDemo(page: Page, question: string, viaPreset = false) {
  await page.goto("/demos/ledger");
  const box = page.getByTestId("ask-box");
  await expect(box).toBeVisible();
  if (viaPreset) {
    await box.getByTestId("preset-chip").filter({ hasText: question }).click();
  } else {
    await box.getByTestId("ask-input").fill(question);
    await box.getByTestId("ask-send").click();
  }
  await page.waitForURL(/\/ask\/[0-9a-f-]{36}/);
}

/** Waits for the Build to finish: Reform done, Ledger back by the chat. */
async function waitForBuild(page: Page) {
  await expect(screen(page)).toHaveAttribute("data-busy", "false", {
    timeout: BUILD_TIMEOUT,
  });
}

/** Every block on the answer page names a real piece of the page, in the page's own words. */
async function expectGrounded(page: Page, blocks: Locator) {
  const count = await blocks.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    const block = blocks.nth(index);
    const source = await block.getAttribute("data-source");
    const excerpt = await block.getAttribute("data-excerpt");
    const piece = page.locator(
      `[data-testid="page-copy"] [data-ledger-source="${source}"]`,
    );
    await expect(piece, `source ${source} exists on the page`).toHaveCount(1);
    if (excerpt) {
      const text = ((await piece.textContent()) ?? "").replace(/\s+/g, " ");
      expect(text, `excerpt of ${source} is verbatim`).toContain(excerpt);
    }
  }
}

async function expectAnswered(page: Page) {
  await waitForBuild(page);
  await expect(page.getByTestId("answer-page")).toBeVisible();
  await expect(screen(page)).toHaveAttribute("data-phase", "answer");
  await expectGrounded(page, page.getByTestId("answer-block"));
  const reply = screen(page)
    .locator('[data-testid="chat-message"][data-role="ledger"]')
    .last();
  await expect(reply).not.toHaveText(/^…?$/);
  expect(page.url(), "?ask= is dropped once the Build starts").not.toContain(
    "ask=",
  );
}

test.describe("Ledger", () => {
  test.beforeEach(async ({ page }) => {
    await recordPoses(page);
  });

  for (const question of PRESET_QUESTIONS) {
    test(`preset: ${question}`, async ({ page }) => {
      await askFromDemo(page, question, true);
      await expect(page.getByTestId("board-block").first()).toBeVisible({
        timeout: BUILD_TIMEOUT,
      });
      await expectAnswered(page);
      const seen = await poses(page);
      expect(seen, "tore the page apart first").toContain("unstitch");
      expect(
        seen.some((pose) => pose === "carry" || pose === "drag"),
        "hauled a block",
      ).toBe(true);
      expect(seen, "stamped it on the board").toContain("stamp");
      expect(seen, "conducted the Reform").toContain("conduct");
    });
  }

  test("KYC figures are cut out of the Maya Philippines bullet, word for word", async ({
    page,
  }) => {
    await askFromDemo(page, PRESET_QUESTIONS[1], true);
    await expectAnswered(page);
    const fromMaya = page.locator(
      '[data-testid="answer-block"][data-source^="experience.3"]',
    );
    const kycProject = page.locator(
      '[data-testid="answer-block"][data-source="projects.1"]',
    );
    expect(
      (await fromMaya.count()) + (await kycProject.count()),
    ).toBeGreaterThan(0);
    if (!live) {
      const cost = page.locator(
        '[data-testid="answer-block"][data-source="experience.3.points.0"][data-excerpt="90% lower KYC operating cost"]',
      );
      await expect(cost).toHaveAttribute("data-kind", "figure");
      await expect(cost).toContainText("90%");
    }
  });

  test("a follow-up rewinds the answer and rebuilds in the same session", async ({
    page,
  }) => {
    await askFromDemo(page, PRESET_QUESTIONS[0], true);
    await expectAnswered(page);
    const sessionUrl = page.url();
    await screen(page).getByTestId("chat-input").fill(PRESET_QUESTIONS[2]);
    await screen(page).getByTestId("chat-send").click();
    await expect(screen(page)).toHaveAttribute("data-phase", "copy");
    await expectAnswered(page);
    expect(page.url()).toBe(sessionUrl);
    await expect(
      screen(page).locator('[data-testid="chat-message"][data-role="visitor"]'),
    ).toHaveCount(2);
    if (!live)
      await expect(page.getByTestId("answer-page")).toHaveAttribute(
        "data-layout",
        "cards",
      );
  });

  test("an off-topic question builds nothing and offers the presets", async ({
    page,
  }) => {
    await askFromDemo(page, "What's the best pizza topping?");
    await waitForBuild(page);
    await expect(screen(page).getByTestId("not-found")).toBeVisible();
    await expect(
      screen(page).getByTestId("not-found").getByTestId("preset-chip"),
    ).toHaveCount(PRESET_QUESTIONS.length);
    await expect(page.getByTestId("answer-page")).toHaveCount(0);
    expect(await poses(page)).toContain("confused");
  });

  test("a stored session shows its answer at once and replays on request", async ({
    page,
  }) => {
    await askFromDemo(page, PRESET_QUESTIONS[3], true);
    await expectAnswered(page);
    const before = await page
      .getByTestId("answer-block")
      .evaluateAll((blocks) =>
        blocks.map((block) => block.getAttribute("data-source")),
      );

    await page.reload();
    await expect(page.getByTestId("answer-page")).toBeVisible({
      timeout: 10_000,
    });
    await expect(screen(page)).toHaveAttribute("data-busy", "false");
    expect(
      await page
        .getByTestId("answer-block")
        .evaluateAll((blocks) =>
          blocks.map((block) => block.getAttribute("data-source")),
        ),
    ).toEqual(before);

    await screen(page).getByTestId("replay-build").last().click();
    await expect(screen(page)).toHaveAttribute("data-phase", "copy");
    await expect(page.getByTestId("board-block").first()).toBeVisible({
      timeout: BUILD_TIMEOUT,
    });
    await expectAnswered(page);
  });

  test("the About page is untouched by a session and has no case file", async ({
    page,
  }) => {
    await askFromDemo(page, PRESET_QUESTIONS[5], true);
    await expectAnswered(page);
    await page.goto("/about");
    await expect(page.getByText("Case file · Digital bank")).toHaveCount(0);
    await expect(page.locator(".ldg-torn")).toHaveCount(0);
    await expect(page.getByTestId("answer-page")).toHaveCount(0);
    await expect(
      page.locator('[data-ledger-source="experience.3.points.0"]'),
    ).toContainText("90% lower KYC operating cost");
  });

  test("an invented excerpt is dropped and never rendered", async ({
    page,
  }) => {
    test.skip(live, "needs a canned plan");
    await askFromDemo(page, STUB_INVENTED);
    await expectAnswered(page);
    await expect(page.getByTestId("answer-block")).toHaveCount(1);
    await expect(page.getByTestId("answer-page")).not.toContainText("99%");
    await expect(page.locator('[data-source="experience.42"]')).toHaveCount(0);
  });

  test("a tossed block spins away and never reaches the answer", async ({
    page,
  }) => {
    test.skip(live, "needs a canned plan");
    await askFromDemo(page, STUB_TOSS);
    await expectAnswered(page);
    expect(await poses(page)).toContain("toss");
    const sources = await page
      .getByTestId("answer-block")
      .evaluateAll((blocks) =>
        blocks.map((block) => block.getAttribute("data-source")),
      );
    expect(sources).toEqual(["experience.3"]);
  });

  test("an over-limit visitor lands on a stored answer", async ({ page }) => {
    test.skip(live, "forces the limit with an e2e header");
    await page.setExtraHTTPHeaders({ "x-ledger-force-limit": "1" });
    await page.goto("/demos/ledger");
    await page
      .getByTestId("ask-box")
      .getByTestId("preset-chip")
      .first()
      .click();
    await page.waitForURL(/notice=limited/);
    await expect(screen(page).getByTestId("notice")).toBeVisible();
    await expect(page.getByTestId("answer-page")).toBeVisible();
  });
});

test.describe("Ledger with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("skips the gallop and still builds the answer", async ({ page }) => {
    test.skip(live, "covered by the stubbed run");
    await recordPoses(page);
    const started = Date.now();
    await askFromDemo(page, PRESET_QUESTIONS[2], true);
    await expectAnswered(page);
    expect(Date.now() - started).toBeLessThan(45_000);
    const seen = await poses(page);
    expect(
      seen.filter((pose) =>
        ["run", "run-up", "run-down", "fly"].includes(pose),
      ),
    ).toEqual([]);
    await expect(page.locator(".print")).toHaveCount(0);
  });
});

test.describe("Ledger on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("builds into one column with a small Ledger", async ({ page }) => {
    test.skip(live, "covered by the stubbed run");
    await recordPoses(page);
    await askFromDemo(page, PRESET_QUESTIONS[1], true);
    await expectAnswered(page);
    const cat = screen(page).getByTestId("ledger-cat");
    expect((await cat.boundingBox())?.width).toBe(72);
    const blocks = page.getByTestId("answer-block");
    const first = await blocks.nth(0).boundingBox();
    const second = await blocks.nth(1).boundingBox();
    expect(second?.x).toBe(first?.x);
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth, "no sideways scroll").toBeLessThanOrEqual(390);
  });
});
