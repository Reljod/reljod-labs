import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import postgres from "postgres";
import {
  DEFAULT_MODELS,
  DEFAULT_RULEBOOK,
  type Rulebook,
  type RulebookVersion,
} from "../src/features/name-extraction/domain/contract";

/*
 * Sieve on its REST routes, stubbed (the e2e default): the Runs the suite
 * starts carry the stub flag to every workflow step, where a script plays
 * the Analyst and its Readers (Readers return the Sweep's Candidates with
 * verbatim quotes) and no Sandbox starts. The gates, the Done gate, the
 * caps, the durable workflow and the database are real, and the suite's
 * rows belong to the `e2e` Owner. Every test starts and ends with none.
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

/** Another Owner, whose Run the suite must not reach by id. */
const OTHER_OWNER = `host:${randomUUID()}`;
/** The 10-page featured Corpus Document: the quickest whole Run. */
const DOCUMENT = {
  id: "ne-te-01",
  title: "Retail customer account-opening file",
};

async function clean() {
  // A Run's events and model calls cascade from it.
  await sql`delete from name_extraction.runs where owner = 'e2e' or owner = ${OTHER_OWNER}`;
  await sql`delete from name_extraction.rulebooks where owner = 'e2e'`;
  await sql`delete from name_extraction.uploads where owner = 'e2e'`;
}

test.beforeAll(clean);
test.afterAll(async () => {
  if (process.env.E2E_KEEP_RUNS !== "1") await clean();
  await sql.end();
});

type RunDetail = {
  id: string;
  status: string;
  gatePassed: boolean | null;
  names: { canonical: string }[];
  events: { type: string }[];
  score: { recall: number } | null;
};

async function runDetail(request: APIRequestContext, runId: string) {
  const response = await request.get(`/api/name-extraction/runs/${runId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as RunDetail;
}

test("a Run on a demo Document goes through the Done gate to its result", async ({
  page,
  request,
}) => {
  await page.goto("/demos/name-extraction");
  await page.getByRole("tab", { name: "Documents" }).click();
  await page
    .getByRole("button", { name: new RegExp(`^Open ${DOCUMENT.title}`) })
    .click();
  const workspace = page.getByRole("region", { name: DOCUMENT.title });
  // The preview reads the Document through the preview routes first.
  await expect(workspace.getByText("Names to find")).toBeVisible({
    timeout: 60_000,
  });

  const started = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/name-extraction/runs") &&
      response.request().method() === "POST",
  );
  await workspace
    .getByRole("button", { name: "Run Sieve on this document" })
    .click();
  const response = await started;
  expect(response.status()).toBe(200);
  const { runId } = (await response.json()) as { runId: string };

  // The page follows the Audit trail over the events stream to the end.
  await expect(workspace.getByText("Result", { exact: true })).toBeVisible({
    timeout: 150_000,
  });

  const run = await runDetail(request, runId);
  expect(run.status).toBe("completed");
  expect(run.gatePassed).toBe(true);
  expect(run.names.length).toBeGreaterThan(0);
  expect(run.score).not.toBeNull();
  const types = new Set(run.events.map((event) => event.type));
  for (const type of ["start", "reader", "names", "gate", "end"])
    expect(types).toContain(type);
  // Stubbed: nothing billed, so no cost event on the trail.
  expect(types).not.toContain("cost");

  // The Run is listed, and a Run that is over cannot be stopped again.
  const listed = await request.get("/api/name-extraction/runs");
  expect(listed.status()).toBe(200);
  expect(
    ((await listed.json()) as { id: string }[]).map((item) => item.id),
  ).toContain(runId);
  const stop = await request.post(`/api/name-extraction/runs/${runId}/stop`);
  expect(stop.status()).toBe(200);
  expect(await stop.json()).toMatchObject({
    stopped: false,
    status: "completed",
  });
});

test("a Rulebook saves as a new version and an earlier one restores", async ({
  request,
}) => {
  const versions = async () => {
    const response = await request.get("/api/name-extraction/rulebooks");
    expect(response.status()).toBe(200);
    return (await response.json()) as RulebookVersion[];
  };
  const save = (rulebook: Rulebook | Record<string, unknown>, note?: string) =>
    request.post("/api/name-extraction/rulebooks", {
      data: { rulebook, note },
    });

  const [before] = await versions();
  expect(before.version).toBe(0);

  const edited: Rulebook = { ...DEFAULT_RULEBOOK, reviewBelow: 0.75 };
  const saved = await save(edited, "Stricter review");
  expect(saved.status()).toBe(200);
  const first = (await saved.json()) as RulebookVersion;
  expect(first).toMatchObject({
    version: 1,
    note: "Stricter review",
    rulebook: edited,
  });
  expect((await versions())[0].version).toBe(1);

  // A Rulebook that would drop the names it flags is refused, and saves nothing.
  const refused = await save({
    ...DEFAULT_RULEBOOK,
    dropBelow: 0.9,
    reviewBelow: 0.5,
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()) as { error: string }).toHaveProperty("error");

  // Restoring the default writes it again as the next version.
  const restored = await save(before.rulebook, "Restored version 0");
  expect(restored.status()).toBe(200);
  expect((await restored.json()) as RulebookVersion).toMatchObject({
    version: 2,
    rulebook: DEFAULT_RULEBOOK,
  });
  const [current] = await versions();
  expect(current.version).toBe(2);
  expect(current.rulebook).toEqual(DEFAULT_RULEBOOK);
});

test("another Owner's Run answers 404 on every route, as if it did not exist", async ({
  request,
}) => {
  const [row] = await sql<{ id: string }[]>`
    insert into name_extraction.runs (
      owner, visitor_hash, title, pages, source, models, rulebook_version, rulebook
    ) values (
      ${OTHER_OWNER}, 'someone', 'Not yours', 10,
      ${sql.json({ kind: "corpus", corpusId: DOCUMENT.id })},
      ${sql.json(DEFAULT_MODELS)}, 0, ${sql.json(DEFAULT_RULEBOOK as never)}
    )
    returning id
  `;
  const theirs = row.id;
  const root = "/api/name-extraction";
  for (const response of [
    await request.get(`${root}/runs/${theirs}`),
    await request.get(`${root}/runs/${theirs}/events`),
    await request.get(`${root}/runs/${theirs}/comparison`),
    await request.get(`${root}/preview/overview?run=${theirs}`),
    await request.get(`${root}/preview/pages?run=${theirs}&from=1&to=12`),
    await request.post(`${root}/runs/${theirs}/stop`),
  ]) {
    expect(response.status()).toBe(404);
  }
  const list = await request.get(`${root}/runs`);
  expect(
    ((await list.json()) as { id: string }[]).map((item) => item.id),
  ).not.toContain(theirs);
  // And it was not stopped.
  const [after] = await sql<{ status: string }[]>`
    select status from name_extraction.runs where id = ${theirs}
  `;
  expect(after.status).toBe("queued");
});
