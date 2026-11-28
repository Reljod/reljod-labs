import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import postgres from "postgres";

/*
 * Casework (Teller) on its REST routes, stubbed (the e2e default): the
 * Specialist's model is a script that calls the tool the message names over
 * the real MCP server, and the Runs it starts read each Cabinet Document by
 * its label instead of a model. The gates, the caps, the durable workflow and
 * the database stay real, and the suite's rows belong to the `e2e` Owner.
 * Every test starts and ends with no `e2e` Desk.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const sql = postgres(process.env.DATABASE_URL ?? "", {
  prepare: false,
  max_pipeline: 1,
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});

/** Another Owner's Desk and Run, to reach by id. */
const OTHER_OWNER = `host:${randomUUID()}`;

async function clean() {
  // Runs, Messages, chat turns and model calls cascade from the Desk.
  await sql`delete from casework.sessions where owner = 'e2e' or owner = ${OTHER_OWNER}`;
}

test.beforeAll(clean);
test.afterAll(async () => {
  if (process.env.E2E_KEEP_RUNS !== "1") await clean();
  await sql.end();
});

type Folder = {
  slug: string;
  title: string;
  documents: { id: string; name: string }[];
};

async function openDesk(request: APIRequestContext) {
  const response = await request.put("/api/casework/desk", { data: {} });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    sessionId: string;
    folders: Folder[];
  };
}

/** Sends one message to the Specialist and gives back its ChatEvents. */
async function say(
  request: APIRequestContext,
  text: string,
  documentIds: string[],
) {
  const response = await request.post("/api/casework/chat", {
    data: { text, documentIds },
  });
  expect(response.status()).toBe(200);
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function runStatus(request: APIRequestContext, runId: string) {
  const response = await request.get("/api/casework/desk");
  expect(response.status()).toBe(200);
  const status = (await response.json()) as {
    runs: { id: string; status: string }[];
  };
  return status.runs.find((run) => run.id === runId)?.status ?? "missing";
}

async function events(request: APIRequestContext, runId: string) {
  const response = await request.get(`/api/casework/runs/${runId}/events`);
  expect(response.status()).toBe(200);
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; status?: string });
}

function bodden(folders: Folder[]) {
  const folder = folders.find((item) => item.slug.startsWith("wd-02"));
  if (!folder)
    throw new Error(
      "The Cabinet has no wd-02 Case file; run pnpm seed:casework",
    );
  return folder;
}

test("opens the desk with the Cabinet, on the page and through the route", async ({
  page,
  request,
}) => {
  const desk = await openDesk(request);
  const folder = bodden(desk.folders);
  expect(folder.documents.length).toBeGreaterThan(3);

  await page.goto("/demos/casework");
  await expect(page.getByText(folder.title).first()).toBeVisible({
    timeout: 60_000,
  });
});

test("the Specialist runs a pipeline over a whole Case file to its decision", async ({
  request,
}) => {
  const folder = bodden((await openDesk(request)).folders);
  const said = await say(
    request,
    "pipeline_pension_withdrawal",
    folder.documents.map((document) => document.id),
  );
  const started = said.find(
    (event) =>
      event.type === "tool-result" &&
      event.name === "pipeline_pension_withdrawal",
  );
  expect(started).toMatchObject({ ok: true });
  const runId = String(started?.runId);

  await expect
    .poll(() => runStatus(request, runId), { timeout: 150_000 })
    .toBe("completed");
  const streamed = await events(request, runId);
  expect(streamed[0]).toMatchObject({ type: "plan" });
  expect(streamed.some((event) => event.type === "decision")).toBe(true);
  expect(streamed.at(-1)).toMatchObject({ type: "end", status: "completed" });
});

test("a Run waiting on a Question stops, and its stream says so", async ({
  request,
}) => {
  const folder = bodden((await openDesk(request)).folders);
  const form = folder.documents.find((document) =>
    /withdrawal request/i.test(document.name),
  );
  // Only the form: the ID it needs is on file, so the Run asks for it and waits.
  const said = await say(request, "pipeline_pension_withdrawal", [
    String(form?.id),
  ]);
  const runId = String(
    said.find((event) => event.type === "tool-result" && event.runId)?.runId,
  );
  await expect
    .poll(() => runStatus(request, runId), { timeout: 150_000 })
    .toBe("waiting");

  const stopped = await request.post(`/api/casework/runs/${runId}/stop`);
  expect(stopped.status()).toBe(200);
  expect(await stopped.json()).toMatchObject({
    stopped: true,
    status: "stopped",
  });
  expect(await runStatus(request, runId)).toBe("stopped");
  const streamed = await events(request, runId);
  expect(streamed.some((event) => event.type === "question")).toBe(true);
  expect(streamed.at(-1)).toMatchObject({ type: "end", status: "stopped" });
});

test("another Owner's Run is not there, by any route", async ({ request }) => {
  await openDesk(request);
  const [theirs] = await sql<{ id: string }[]>`
    insert into casework.sessions (visitor_hash, owner)
    values ('e2e-other', ${OTHER_OWNER}) returning id`;
  const [run] = await sql<{ id: string }[]>`
    insert into casework.runs (session_id, jobs, document_ids, visitor_hash, status, workflow_run_id)
    values (${theirs?.id ?? ""}, '{sort}', '{}', 'e2e-other', 'running', 'wrun_not_real')
    returning id`;
  const runId = run?.id ?? "";

  const read = await request.get(`/api/casework/runs/${runId}/events`);
  expect(read.status()).toBe(404);
  const stop = await request.post(`/api/casework/runs/${runId}/stop`);
  expect(stop.status()).toBe(404);
  const open = await request.put("/api/casework/desk", {
    data: { deskId: theirs?.id },
  });
  expect(open.status()).toBe(404);
  const [still] = await sql<{ status: string }[]>`
    select status from casework.runs where id = ${runId}`;
  expect(still?.status).toBe("running");
});
