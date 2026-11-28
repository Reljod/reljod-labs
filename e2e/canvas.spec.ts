import { expect, type Page, test } from "@playwright/test";
import { STUB_PROBES, STUB_SPEC } from "../src/features/canvas/domain/stub";
import { E2E_HEADER, E2E_LIVE_HEADER } from "../src/platform/request/headers";

/*
 * Canvas, the main path a person takes. Stubbed by default (the e2e token
 * alone): the Analyst's turn is a scripted tool sequence and the Sandbox is
 * the canned one, which parses from trees DuckDB really produced, so nothing
 * is spent. Everything else is real: the MCP server, the Guard, the checks,
 * the Trail, the View App in its sandboxed frame. It writes to the `e2e`
 * Workspace in the database. A token taken here carries the stub mode, so
 * the MCP requests the suite makes with it are stubbed too.
 *
 * Needs `supabase/migrations/20261119160000_canvas.sql` applied. Opt-in with
 * `E2E_CANVAS=1`; add `E2E_CANVAS_LIVE=1` for the one real model Question
 * (the real Sandbox, or `CANVAS_LOCAL_RUNNER`, on the server).
 */
test.skip(
  process.env.E2E_CANVAS !== "1",
  "Set E2E_CANVAS=1 once the Canvas migration is applied.",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const BYPASS = { [E2E_HEADER]: process.env.E2E_BYPASS_TOKEN ?? "" };
const TITLE = "Daily peak load in Kestrel Coast";

async function askStarter(page: Page, question: string) {
  await page.goto("/demos/canvas");
  await page.getByRole("textbox", { name: "Your Question" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

test.describe("stubbed Analyst", () => {
  test.use({ extraHTTPHeaders: BYPASS });

  test("a Question comes back as a View in a sandboxed frame, and a Control re-runs it with no model call", async ({
    page,
  }) => {
    const chatCalls: string[] = [];
    const appCalls: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path === "/api/canvas/chat") chatCalls.push(path);
      if (path === "/api/canvas/app/call") appCalls.push(path);
    });

    // An empty canvas explains itself.
    await page.goto("/demos/canvas");
    await expect(page.getByTestId("canvas-explainer")).toBeVisible();

    await askStarter(page, "Show daily peak load in Kestrel Coast");

    // While the Analyst works, the canvas says so, step by step.
    await expect(page.getByTestId("canvas-working")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("canvas-explainer")).toBeHidden();

    // The View is the MCP App's own document, sandboxed to scripts only.
    const frameElement = page.getByTestId("view-frame").first();
    await expect(frameElement).toBeVisible({ timeout: 120_000 });
    await expect(frameElement).toHaveAttribute("sandbox", "allow-scripts");
    await expect(frameElement).toHaveAttribute("data-revision", "1");
    const frame = page.frameLocator('[data-testid="view-frame"]').first();
    await expect(frame.getByText(TITLE).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(frame.getByText("Verified").first()).toBeVisible();
    // Drawn by the App from rows: a chart, not model HTML.
    await expect(frame.locator("svg").first()).toBeVisible();

    // Done: the working state goes, and the thread stays inside its panel.
    await expect(page.getByTestId("canvas-working")).toBeHidden({
      timeout: 60_000,
    });
    const thread = page.getByTestId("thread");
    const contained = await thread.evaluate((element) => {
      const panel = element.closest("section")?.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return !!panel && box.bottom <= panel.bottom + 1;
    });
    expect(contained).toBe(true);

    // The thread shows the tools that ran, and the turn is saved.
    await expect(thread.getByText("create_view")).toBeVisible();
    await expect(thread.getByText("run_query")).toBeVisible();
    expect(chatCalls).toHaveLength(1);

    // A Control change: the App asks its Host for tools/call, the Query runs again.
    const slider = frame.locator('input[type="range"]').first();
    await expect(slider).toBeEnabled();
    await slider.fill("2000");
    await expect(frameElement).toHaveAttribute("data-revision", "2", {
      timeout: 60_000,
    });
    expect(appCalls.length).toBeGreaterThanOrEqual(1);
    // No second Question was asked: no model was called for the change.
    expect(chatCalls).toHaveLength(1);

    // Under the hood: the Trail has the change, and the Bridge log has the messages.
    await page.getByTestId("canvas-tab-hood").click();
    const trail = page.getByTestId("trail");
    await expect(
      trail.getByText("View Parameters changed").first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(trail.getByText("Query finished").first()).toBeVisible();
    await expect(trail.getByText("View created").first()).toBeVisible();
    const bridge = page.getByTestId("bridge-log");
    await expect(bridge.getByText("ui/initialize").first()).toBeVisible();
    await expect(bridge.getByText("tools/call").first()).toBeVisible();
    await expect(
      bridge.getByText("ui/notifications/tool-result").first(),
    ).toBeVisible();
  });

  test("the same journey through the MCP endpoint, with an MCP Apps client; a Rule blocks a Restricted column", async ({
    page,
    baseURL,
  }) => {
    // A per-Owner token, taken on the Connect place.
    await page.goto("/demos/canvas");
    await page.getByTestId("canvas-tab-connect").click();
    await page.getByRole("button", { name: "Make a token" }).click();
    const header = page.getByText(/Authorization: Bearer canvas_/);
    await expect(header).toBeVisible({ timeout: 30_000 });
    const token = ((await header.textContent()) ?? "")
      .split("Bearer ")[1]
      .trim();
    const url = `${baseURL}/api/canvas/mcp`;

    // No bearer, no entry.
    const refused = await page.request.post(url, {
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(refused.status()).toBe(401);

    const mcp = await import("@ai-sdk/mcp");
    const client = await mcp.createMCPClient({
      clientName: "canvas-e2e",
      capabilities: mcp.mcpAppClientCapabilities,
      transport: {
        type: "http",
        url,
        headers: { authorization: `Bearer ${token}` },
      },
    });
    const text = (result: unknown) =>
      (
        ((result as { content?: unknown }).content as
          | { text?: string }[]
          | undefined) ?? []
      )
        .map((item) => item.text ?? "")
        .join("\n");
    try {
      // The View tools point at the UI resource, and the resource is the App.
      const listed = await client.listTools();
      const createTool = listed.tools.find(
        (tool) => tool.name === "create_view",
      );
      expect(
        (createTool?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
          ?.resourceUri,
      ).toBe("ui://canvas/view.html");
      const { appVisible } = mcp.splitMCPAppTools(listed);
      expect(appVisible.tools.map((tool) => tool.name)).toContain(
        "update_view_params",
      );
      const app = await mcp.readMCPAppResource({
        client,
        uri: "ui://canvas/view.html",
      });
      expect(app.mimeType).toBe("text/html;profile=mcp-app");
      expect(app.html).toContain("<!doctype html>");
      expect(app.html).not.toMatch(/<script[^>]+src=/);

      // Make a View, then change a Parameter: both return the payload the App draws.
      const made = await client.callTool({
        name: "create_view",
        arguments: { spec: STUB_SPEC },
      });
      expect(made.isError ?? false).toBe(false);
      const first = made.structuredContent as {
        kind: string;
        view: {
          id: string;
          revision: number;
          status: string;
          result: { rowCount: number };
        };
      };
      expect(first.kind).toBe("canvas.view");
      expect(first.view.status).toBe("verified");
      expect(first.view.result.rowCount).toBe(28);

      const changed = await client.callTool({
        name: "update_view_params",
        arguments: { viewId: first.view.id, params: { min_peak: 2000 } },
      });
      const second = changed.structuredContent as typeof first;
      expect(second.view.revision).toBe(2);
      expect(second.view.result.rowCount).toBeLessThan(28);

      // The Guard: a Restricted column never comes back row by row...
      const rowLevel = await client.callTool({
        name: "run_query",
        arguments: { sql: STUB_PROBES.rowLevel },
      });
      expect(rowLevel.isError).toBe(true);
      expect(text(rowLevel)).toMatch(/Restricted/i);
      // ...not behind a comment or a subquery either...
      const hidden = await client.callTool({
        name: "run_query",
        arguments: { sql: STUB_PROBES.hiddenInSubquery },
      });
      expect(hidden.isError).toBe(true);
      expect(text(hidden)).toMatch(/Restricted/i);
      // ...but aggregated above the minimum group size it does.
      const aggregated = await client.callTool({
        name: "run_query",
        arguments: { sql: STUB_PROBES.meanIncome },
      });
      expect(aggregated.isError ?? false).toBe(false);
      expect(text(aggregated)).toMatch(/minimum group size/i);
      // Files are never read.
      const file = await client.callTool({
        name: "run_query",
        arguments: { sql: STUB_PROBES.readFile },
      });
      expect(file.isError).toBe(true);

      // A Rule edit takes effect at the query tool: restrict a column, and it is refused.
      const sql = STUB_PROBES.cardAmounts;
      const before = await client.callTool({
        name: "run_query",
        arguments: { sql },
      });
      expect(before.isError ?? false).toBe(false);
      const rules = await client.callTool({ name: "get_rules", arguments: {} });
      const current = (
        rules.structuredContent as {
          rules: Record<string, { params: { columns?: string[] } }>;
        }
      ).rules["access.restricted_columns"].params.columns as string[];
      const saved = await client.callTool({
        name: "save_rules",
        arguments: {
          edits: [
            {
              id: "access.restricted_columns",
              params: { columns: [...current, "card_spend.amount_mdc"] },
            },
          ],
        },
      });
      expect(saved.isError ?? false).toBe(false);
      try {
        const after = await client.callTool({
          name: "run_query",
          arguments: { sql },
        });
        expect(after.isError).toBe(true);
        expect(text(after)).toMatch(/Restricted/i);
      } finally {
        await client.callTool({
          name: "save_rules",
          arguments: {
            edits: [
              { id: "access.restricted_columns", params: { columns: current } },
            ],
          },
        });
      }

      // A bad Rule value is refused where it is made.
      const bad = await client.callTool({
        name: "save_rules",
        arguments: {
          edits: [{ id: "verify.tolerance", params: { percent: 900 } }],
        },
      });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("a Rule is edited on the Rules place and saved as a new Version", async ({
    page,
  }) => {
    await page.goto("/demos/canvas");
    await page.getByTestId("canvas-tab-rules").click();
    const tolerance = page.locator('[id="rule-verify.tolerance-percent"]');
    await expect(tolerance).toBeVisible();
    const was = await tolerance.inputValue();
    const next = was === "1" ? "0.5" : "1";
    await tolerance.fill(next);
    await page.getByRole("button", { name: /Save 1 change/ }).click();
    await expect(page.getByText(/Saved as Rulebook v\d+\./)).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await page.getByTestId("canvas-tab-rules").click();
    await expect(
      page.locator('[id="rule-verify.tolerance-percent"]'),
    ).toHaveValue(next);
  });
});

test.describe("without Access", () => {
  test.use({ extraHTTPHeaders: {} });

  test("the page and every route refuse a visitor with no Access", async ({
    page,
    request,
  }) => {
    for (const path of [
      "/api/canvas/rules",
      "/api/canvas/conversations",
      "/api/canvas/trail",
      "/api/canvas/app/frame",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect([401, 307], path).toContain(response.status());
    }
    const chat = await request.post("/api/canvas/chat", {
      data: { text: "hello" },
      maxRedirects: 0,
    });
    expect([401, 307]).toContain(chat.status());
    const call = await request.post("/api/canvas/app/call", {
      data: { name: "update_view_params", arguments: {} },
      maxRedirects: 0,
    });
    expect([401, 307]).toContain(call.status());
    // The writes that were server actions are gated REST routes now.
    const writes = [
      request.post("/api/canvas/rules", {
        data: { edits: [{ id: "verify.tolerance", params: { percent: 1 } }] },
        maxRedirects: 0,
      }),
      request.post("/api/canvas/tokens", { maxRedirects: 0 }),
      request.delete(
        "/api/canvas/conversations/00000000-0000-4000-8000-000000000000",
        { maxRedirects: 0 },
      ),
    ];
    for (const response of await Promise.all(writes))
      expect([401, 307], response.url()).toContain(response.status());
    await page.goto("/demos/canvas");
    await expect(page).not.toHaveURL(/\/demos\/canvas$/);
  });
});

test.describe("the real Analyst", () => {
  test.skip(
    process.env.E2E_CANVAS_LIVE !== "1",
    "Set E2E_CANVAS_LIVE=1 to ask the real model one Question (a few cents).",
  );
  test.use({ extraHTTPHeaders: { ...BYPASS, [E2E_LIVE_HEADER]: "1" } });

  test("one live Question is answered with a View and its cost is shown", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await askStarter(
      page,
      "What was the highest hourly grid load in each region in 2025? Answer with one bar chart.",
    );
    const frameElement = page.getByTestId("view-frame").first();
    await expect(frameElement).toBeVisible({ timeout: 360_000 });
    const frame = page.frameLocator('[data-testid="view-frame"]').first();
    await expect(frame.getByText(/Verified|Flagged/).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole("button", { name: "Ask", exact: true }),
    ).toBeVisible({
      timeout: 360_000,
    });
    const usage = page.getByTestId("usage");
    await expect(usage).toContainText(/turns/);
    await expect(usage).toContainText(/\$\d/);
    await expect(usage).not.toContainText("stub");
  });
});
