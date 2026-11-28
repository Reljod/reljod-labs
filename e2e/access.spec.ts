import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

/*
 * The door, as a visitor sees it: no e2e token (that would pass the gate),
 * and an address of its own (`x-forwarded-for`, honoured by the local
 * server; Vercel sets it itself), so this run's one wrong Guest code counts
 * against nobody else and is deleted afterwards. Nothing here needs a real
 * Host or Guest code, and nothing calls a paid model.
 */
const suffix = randomUUID().replaceAll("-", "");
const ip = `2001:db8::${suffix.slice(0, 4)}:${suffix.slice(4, 8)}`;
const visitorHash = createHash("sha256")
  .update(`${process.env.RATE_LIMIT_SALT ?? ""}:${ip}`)
  .digest("hex");

test.use({ extraHTTPHeaders: { "x-forwarded-for": ip } });

const sql = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, {
      prepare: false,
      max_pipeline: 1,
      max: 1,
      onnotice: () => {},
    })
  : null;

test.afterAll(async () => {
  if (!sql) return;
  await sql`delete from access.attempts where visitor_hash = ${visitorHash}`;
  await sql.end();
});

const BAD_CODE = /That code did not open the door/;
const PASS = "00000000-0000-4000-8000-000000000000";

test("the door turns a wrong Guest code away, and counts the try", async ({
  page,
}) => {
  await page.goto("/access");
  await expect(
    page.getByRole("heading", { name: "Open the demos" }),
  ).toBeVisible();
  await page.getByTestId("guest-code").fill("AAAA-BBBB-CCCC");
  await page.getByRole("button", { name: "Open the demos" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: BAD_CODE }),
  ).toBeVisible();
  // Still at the door, with no Access.
  await expect(page).toHaveURL(/\/access$/);

  if (!sql)
    throw new Error("Set DATABASE_URL in .env.local to check the count");
  const rows = await sql<{ succeeded: boolean }[]>`
    select succeeded from access.attempts
    where visitor_hash = ${visitorHash} and kind = 'code'`;
  expect(rows).toEqual([{ succeeded: false }]);
});

test("a visitor's profile is nobody", async ({ request }) => {
  const response = await request.get("/api/access/session");
  expect(response.status()).toBe(200);
  expect(await response.json()).toBeNull();
});

test("a Host's routes answer 401 to a request with no session, and to the e2e suite", async ({
  playwright,
  baseURL,
}) => {
  const routes: [string, string][] = [
    ["POST", "/api/access/guest-passes"],
    ["POST", `/api/access/guest-passes/${PASS}/extend`],
    ["POST", `/api/access/guest-passes/${PASS}/code`],
    ["POST", `/api/access/guest-passes/${PASS}/revoke`],
    ["POST", `/api/access/guest-passes/${PASS}/restore`],
    ["DELETE", `/api/access/guest-passes/${PASS}`],
    ["PATCH", "/api/access/profile"],
    ["PUT", "/api/access/password"],
    ["DELETE", "/api/access/mcp-clients"],
  ];
  const asked: Record<string, string>[] = [
    {},
    // The e2e suite passes the gate, but it is not a Host.
    { "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "" },
  ];
  for (const headers of asked) {
    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: headers,
    });
    for (const [method, path] of routes) {
      const response = await context.fetch(path, {
        method,
        data: {},
        headers: { origin: baseURL ?? "" },
      });
      expect(response.status(), `${method} ${path}`).toBe(401);
    }
    await context.dispose();
  }
});

test("a write from another site is refused before it reaches the door", async ({
  request,
}) => {
  for (const [method, path] of [
    ["POST", "/api/access/session"],
    ["POST", "/api/access/guest-session"],
    ["DELETE", "/api/access/session"],
  ]) {
    const response = await request.fetch(path, {
      method,
      data: { email: "someone@example.com", password: "x", code: "x" },
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(response.status(), `${method} ${path}`).toBe(403);
    expect((await response.json()).error).toMatch(/didn't come from this site/);
  }
});
