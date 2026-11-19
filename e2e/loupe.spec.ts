import {
  type APIRequestContext,
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from "@playwright/test";

/*
 * Loupe, the main journey. Under the e2e bypass the Examiner is scripted
 * (no model, no spend): it walks the same tools through the same MCP server
 * over a Sample's recorded Sweep, so the Trail, the Done gate, the Findings
 * and the Verdict are real. The MCP journey runs the Sweep for real in a
 * Vercel Sandbox (no model). One test, opt-in with `E2E_LOUPE_LIVE=1`, runs
 * the real Examiner on a small tampered Sample.
 *
 * Needs `supabase/migrations/20261119140000_loupe.sql` applied. Writes to the
 * `e2e` Owner's rows in the `loupe` schema.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const TAMPERED = "lp-tr-payslip-01-t2";
const GENUINE = "lp-tr-payslip-01";

async function examine(page: Page, sampleId: string) {
  await page.goto("/demos/loupe");
  await page.getByTestId(`loupe-sample-${sampleId}`).click();
  await page.getByTestId("loupe-start").click();
  await expect(page.getByTestId("loupe-stage")).toBeVisible({ timeout: 60_000 });
  // The Examination is over when Re-evaluate is offered.
  await expect(page.getByTestId("loupe-reevaluate")).toBeVisible({
    timeout: 180_000,
  });
  return new URL(page.url()).searchParams.get("x") as string;
}

/** Puts the e2e Owner's Rulebook back to the Defaults, if it is not there already. */
async function restoreDefaults(page: Page) {
  await page.getByTestId("loupe-tab-rules").click();
  await page.getByTestId("loupe-defaults").click();
  const save = page.getByTestId("loupe-save-rules");
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByTestId("loupe-saved")).toBeVisible({
      timeout: 30_000,
    });
  }
}

test("the page says what it is and shows its measured error rates", async ({
  page,
}) => {
  await page.goto("/demos/loupe");
  await expect(page.getByRole("heading", { name: "Loupe" })).toBeVisible();
  const claim = page.getByTestId("loupe-claim");
  await expect(claim).toContainText("Evidence for a human reviewer");
  await expect(claim).toContainText("false-positive rate");
  await restoreDefaults(page);
});

test("a genuine document is not flagged", async ({ page }) => {
  await examine(page, GENUINE);
  await expect(page.getByTestId("loupe-verdict")).toHaveAttribute(
    "data-verdict",
    "genuine",
  );
  await expect(page.getByTestId("loupe-score")).toContainText("not altered");
  await expect(page.getByTestId("loupe-gate")).toHaveAttribute(
    "data-passed",
    "true",
  );
});

test("a tampered document is caught, boxed on the page, and a Rule edit changes the Verdict on re-evaluate", async ({
  page,
}) => {
  const id = await examine(page, TAMPERED);
  const verdict = page.getByTestId("loupe-verdict");
  await expect(verdict).not.toHaveAttribute("data-verdict", "genuine");
  await expect(page.getByTestId("loupe-finding").first()).toBeVisible();
  await expect(page.getByTestId("loupe-finding-box").first()).toBeVisible();
  await expect(page.getByTestId("loupe-score")).toContainText("altered in");
  // The scripted Examiner really went through the tools.
  await expect(page.getByTestId("loupe-tool").first()).toBeVisible();
  await expect(page.getByTestId("loupe-gate")).toHaveAttribute(
    "data-passed",
    "true",
  );

  // Open a Finding: its measured value, its Rule and the code behind it.
  await page.getByTestId("loupe-finding").first().getByRole("button").first().click();
  await expect(page.getByText("The code that measured it").first()).toBeVisible();

  // Under the hood shows what ran.
  await page.getByTestId("loupe-tab-hood").click();
  await expect(page.getByTestId("loupe-hood")).toContainText("Tool calls");
  await expect(page.getByTestId("loupe-calibration").first()).toBeVisible();

  // Turn off every Rule that produced a counted Finding, save, re-evaluate: no model call.
  const detail = (await (
    await page.request.get(`/api/loupe/examinations/${id}`)
  ).json()) as { findingList: { metric: string; weight: string }[] };
  const metrics = [
    ...new Set(
      detail.findingList
        .filter((finding) => finding.weight !== "context")
        .map((finding) => finding.metric),
    ),
  ];
  expect(metrics.length).toBeGreaterThan(0);
  await page.getByTestId("loupe-tab-rules").click();
  for (const metric of metrics) {
    await page
      .getByTestId(`loupe-rule-${metric}`)
      .getByRole("checkbox")
      .first()
      .uncheck();
  }
  await expect(page.getByTestId("loupe-changes")).toBeVisible();
  // The Calibration follows the draft before it is saved.
  await expect(page.getByTestId("loupe-calibration").first()).toContainText(
    "Saved Rulebook",
  );
  await page.getByTestId("loupe-save-rules").click();
  await expect(page.getByTestId("loupe-saved")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("loupe-tab-examine").click();
  await page.getByTestId("loupe-reevaluate").click();
  await expect(page.getByTestId("loupe-reevaluate-note")).toContainText(
    "Genuine",
    { timeout: 30_000 },
  );
  await expect(verdict).toHaveAttribute("data-verdict", "genuine");

  // Back to the Defaults, and the Verdict comes back with them.
  await restoreDefaults(page);
  await page.getByTestId("loupe-tab-examine").click();
  await page.getByTestId("loupe-reevaluate").click();
  await expect(verdict).not.toHaveAttribute("data-verdict", "genuine", {
    timeout: 30_000,
  });
});

// The same journey through the MCP endpoint ------------------------------------------------

type Rpc = { result?: Record<string, unknown>; error?: { message: string } };

/** One JSON-RPC call to the Loupe MCP server; the answer may come as JSON or as one SSE message. */
async function rpc(
  api: APIRequestContext,
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Rpc> {
  const response = await api.post("/api/loupe/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  expect(response.status(), await response.text()).toBe(200);
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return JSON.parse(data ?? text) as Rpc;
}

async function tool(
  api: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const answer = await rpc(api, token, "tools/call", { name, arguments: args });
  expect(answer.error, JSON.stringify(answer.error)).toBeUndefined();
  return answer.result as {
    isError?: boolean;
    content: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
  };
}

test("an outside client examines a document through the MCP server, with the Sweep run in the Sandbox", async ({
  page,
  baseURL,
}) => {
  await page.goto("/demos/loupe?tab=connect");
  await page.getByTestId("loupe-mint").click();
  const command = await page.getByTestId("loupe-token-command").innerText();
  const token = /Bearer (loupe_[\w.-]+)/.exec(command)?.[1] as string;
  expect(token).toBeTruthy();

  // No cookies and no e2e header: the token is the only way in.
  const api = await playwrightRequest.newContext({ baseURL });
  const init = await rpc(api, token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "loupe-e2e", version: "1" },
  });
  expect(JSON.stringify(init.result)).toContain("loupe");

  const listed = await rpc(api, token, "tools/list", {});
  const names = (listed.result?.tools as { name: string }[]).map((t) => t.name);
  for (const name of [
    "look",
    "run_check",
    "run_code",
    "hypothesize",
    "conclude",
    "review_finding",
    "finish",
    "start_examination",
    "get_examination",
    "get_evidence",
    "edit_rule",
    "reevaluate",
    "read_trail",
    "get_calibration",
  ])
    expect(names).toContain(name);

  const samples = await tool(api, token, "list_samples");
  expect(JSON.stringify(samples.structuredContent)).toContain(TAMPERED);

  const started = await tool(api, token, "start_examination", {
    sampleId: TAMPERED,
    mode: "sweep",
  });
  expect(started.isError, started.content[0]?.text).toBeFalsy();
  const examinationId = started.structuredContent?.examinationId as string;

  let examination: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        examination = (
          await tool(api, token, "get_examination", { examinationId })
        ).structuredContent as Record<string, unknown>;
        return examination.status;
      },
      { timeout: 200_000, intervals: [3000] },
    )
    .toBe("completed");
  expect(examination.verdict).not.toBe("genuine");
  expect((examination.findingList as unknown[]).length).toBeGreaterThan(0);

  const trail = await tool(api, token, "read_trail", { examinationId });
  const events = trail.structuredContent?.events as { type: string; mode?: string }[];
  expect(events.some((event) => event.type === "sweep")).toBe(true);

  const rules = await tool(api, token, "list_rules");
  expect(JSON.stringify(rules.structuredContent)).toContain("image.ela_ratio");
  const calibration = await tool(api, token, "get_calibration");
  expect(JSON.stringify(calibration.structuredContent)).toContain(
    "falsePositiveRate",
  );

  // The Examiner's own tools are closed on an Examination the client does not drive.
  const refused = await tool(api, token, "finish", {
    examinationId,
    summary: "Trying to finish someone else's work.",
  });
  expect(refused.isError).toBe(true);
  await api.dispose();
});

test("without Access, nothing opens", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: {},
  });
  for (const path of [
    "/api/loupe/examinations",
    "/api/loupe/rulebooks",
    "/api/loupe/corpus",
    "/api/loupe/examinations/00000000-0000-4000-8000-000000000000/asset?key=pages/p1.jpg",
  ]) {
    const response = await anonymous.get(path, {
      headers: { "x-e2e-token": "" },
    });
    expect(response.status(), path).toBe(401);
  }
  const mcp = await anonymous.post("/api/loupe/mcp", {
    headers: {
      "x-e2e-token": "",
      authorization: "Bearer loupe_not-a-token.x",
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect(mcp.status()).toBe(401);
  const page = await anonymous.get("/demos/loupe", {
    headers: { "x-e2e-token": "" },
    maxRedirects: 0,
  });
  expect([302, 307, 308]).toContain(page.status());
  await anonymous.dispose();
});

test.describe("with the real model", () => {
  test.skip(
    process.env.E2E_LOUPE_LIVE !== "1",
    "Set E2E_LOUPE_LIVE=1 to run one real Examination (a few cents).",
  );
  test.use({
    extraHTTPHeaders: {
      "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "",
      "x-loupe-live": "1",
    },
  });
  test.setTimeout(420_000);

  test("the real Examiner looks, runs code in the Sandbox and the Rules give a Verdict", async ({
    page,
  }) => {
    await page.goto("/demos/loupe");
    await page.getByTestId(`loupe-sample-${TAMPERED}`).click();
    await page.getByTestId("loupe-start").click();
    await expect(page.getByTestId("loupe-reevaluate")).toBeVisible({
      timeout: 400_000,
    });
    await expect(page.getByTestId("loupe-verdict")).not.toHaveAttribute(
      "data-verdict",
      "genuine",
    );
    await expect(page.getByTestId("loupe-tool").first()).toBeVisible();
    const id = new URL(page.url()).searchParams.get("x");
    const detail = (await (
      await page.request.get(`/api/loupe/examinations/${id}`)
    ).json()) as { costUsd: number; events: { type: string; tool?: string }[] };
    expect(detail.costUsd).toBeGreaterThan(0);
    expect(
      detail.events.some((e) => e.type === "tool" && e.tool === "look"),
    ).toBe(true);
    // It proved what it saw: a Check or its own code ran in the Sandbox.
    expect(
      detail.events.some(
        (e) =>
          e.type === "tool" && (e.tool === "run_check" || e.tool === "run_code"),
      ),
    ).toBe(true);
    console.log(
      `live Examination ${id}: $${detail.costUsd}, tools: ${detail.events
        .filter((e) => e.type === "tool")
        .map((e) => e.tool)
        .join(",")}`,
    );
  });
});
