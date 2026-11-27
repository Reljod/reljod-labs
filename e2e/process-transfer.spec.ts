import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import postgres from "postgres";

/*
 * Handover on its REST routes, stubbed (the e2e default): the Runs the suite
 * starts carry `stub`, so their workflow steps use the scripted Analyst (a
 * short Process built from the Sample, a Deck planned by rule, a reviewer
 * that finds nothing) and call no model. The gates, the caps, the durable
 * workflow, the Checks under the Owner's Rules, the Audit trail and the
 * database stay real, and the suite's rows belong to the `e2e` Owner. Every
 * test starts with no `e2e` Runs, Rules or Audit lines, and the suite
 * leaves none.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const API = "/api/process-transfer";
const SAMPLE = "Month-end contribution reconciliation";

const sql = postgres(process.env.DATABASE_URL ?? "", {
  prepare: false,
  max_pipeline: 1,
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});

/** Another Owner, whose Run the suite must not reach by id. */
const OTHER_OWNER = `host:${randomUUID()}`;

async function clean() {
  // Model calls cascade from their Run; the Audit trail refuses only updates.
  await sql`delete from process_transfer.runs where owner = 'e2e' or owner = ${OTHER_OWNER}`;
  await sql`delete from process_transfer.audit_events where owner = 'e2e' or owner = ${OTHER_OWNER}`;
  await sql`delete from process_transfer.settings where owner = 'e2e'`;
}

test.beforeAll(clean);
test.afterAll(async () => {
  if (process.env.E2E_KEEP_RUNS !== "1") await clean();
  await sql.end();
});

type RunView = {
  id: string;
  status: string;
  rulesVersion: number;
  approval: { status: "approved" | "held" } | null;
  calls: unknown[];
};

async function readRun(request: APIRequestContext, runId: string) {
  const response = await request.get(`${API}/runs/${runId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { run: RunView }).run;
}

/** Waits until the Run's row says it is over. */
async function finished(request: APIRequestContext, runId: string) {
  await expect
    .poll(async () => (await readRun(request, runId)).status, {
      timeout: 180_000,
      intervals: [1000, 2000],
    })
    .toBe("completed");
  return readRun(request, runId);
}

function runIdOf(page: Page): string {
  const id = new URL(page.url()).searchParams.get("run");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id as string;
}

let runId = "";

test("a Sample becomes a Process and a Deck, and the finished Run reopens from the address", async ({
  page,
}) => {
  await page.goto("/demos/process-transfer");
  await page.getByRole("button", { name: new RegExp(`^${SAMPLE}`) }).click();
  const convert = page.getByRole("button", { name: "Convert this recording" });
  await convert.click();

  // The Run opens at once and follows its stream to the end.
  await expect(page).toHaveURL(/[?&]run=[0-9a-f-]{36}/);
  runId = runIdOf(page);
  await expect(page.getByText("Finished").first()).toBeVisible({
    timeout: 180_000,
  });

  const run = await finished(page.request, runId);
  // The scripted Process passes every default Rule, so its Deck is approved, and nothing was paid for.
  expect(run.approval?.status).toBe("approved");
  expect(run.rulesVersion).toBe(0);
  expect(run.calls).toEqual([]);

  // Reopened from the address alone, on a fresh page: read on the server, no stream to wait for.
  const again = await page.context().newPage();
  await again.goto(`/demos/process-transfer?run=${runId}`);
  await expect(again.getByText("Finished").first()).toBeVisible();
  await expect(again.getByText("Approved").first()).toBeVisible();
  await again.close();

  // The Desk lists it, with no Run still going.
  const desk = await page.request.get(`${API}/desk`);
  expect(desk.status()).toBe(200);
  const { desk: view } = (await desk.json()) as {
    desk: { runs: { id: string }[]; activeRunId: string | null };
  };
  expect(view.runs.map((item) => item.id)).toContain(runId);
  expect(view.activeRunId).toBeNull();
});

test("a Rule saved after the Run is applied by its Redo, and holds the Deck", async ({
  page,
}) => {
  expect(runId, "the first test starts the Run").not.toBe("");
  const request = page.request;

  // At least 6 steps: the scripted Process has 5, so the blocking Check fails.
  const saved = await request.put(`${API}/rules/process.step-count`, {
    data: { override: { params: { min: 6 } } },
  });
  expect(saved.status()).toBe(200);
  const rules = (await saved.json()) as { rulesVersion: number };
  expect(rules.rulesVersion).toBe(1);

  const redo = await request.post(`${API}/runs/${runId}/redo`);
  expect(redo.status()).toBe(200);
  expect(await redo.json()).toEqual({ runId });

  const run = await finished(request, runId);
  expect(run.rulesVersion).toBe(1);
  expect(run.approval?.status).toBe("held");

  // The screen shows the redone Run as held, under the new Rules.
  await page.goto(`/demos/process-transfer?run=${runId}`);
  await expect(page.getByText("Held").first()).toBeVisible();
  await expect(
    page.getByText("1 blocking under Rules v1", { exact: false }),
  ).toBeVisible();

  // The Audit trail recorded the change and the Redo, for this Owner only.
  const audit = await request.get(`${API}/audit?run=${runId}`);
  expect(audit.status()).toBe(200);
  const { events } = (await audit.json()) as {
    events: { action: string }[];
  };
  expect(events.map((event) => event.action)).toEqual(
    expect.arrayContaining(["run.started", "deck.redone", "deck.held"]),
  );
});

test("another Owner's Run is not found, on every route that takes its id", async ({
  request,
}) => {
  const [other] = await sql<{ id: string }[]>`
    insert into process_transfer.runs (owner, visitor_hash, source_kind, sample_slug, title, status, workflow_run_id)
    values (${OTHER_OWNER}, 'e2e-other', 'sample', 'contribution-reconciliation', 'Not yours', 'running', 'wf-not-yours')
    returning id`;
  const id = other.id;

  expect((await request.get(`${API}/runs/${id}`)).status()).toBe(404);
  expect((await request.get(`${API}/runs/${id}/events`)).status()).toBe(404);
  expect((await request.post(`${API}/runs/${id}/stop`)).status()).toBe(404);
  expect((await request.post(`${API}/runs/${id}/redo`)).status()).toBe(404);
  expect(
    (
      await request.post(`${API}/runs/${id}/exports`, {
        data: { kind: "docx" },
      })
    ).status(),
  ).toBe(404);
  // A malformed id is not found either, and reads nothing.
  expect((await request.get(`${API}/runs/not-a-run`)).status()).toBe(404);

  // Untouched: still running, under its own Owner.
  const [after] = await sql<{ status: string }[]>`
    select status from process_transfer.runs where id = ${id}`;
  expect(after.status).toBe("running");
});
