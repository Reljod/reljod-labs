/**
 * A smoke test of the bank against a RUNNING app and its database, as the
 * e2e Owner: the MCP server (tools listed, a read, a sensitive write that
 * must wait for a person), then a payment written through the engine and
 * followed through the outbox and its Workflows by fast-forwarding the
 * clock. Skipped unless BANK_SMOKE_URL is set:
 *
 *   BANK_SMOKE_URL=http://localhost:3111 node --env-file=.env.local \
 *     node_modules/vitest/vitest.mjs run src/features/bank/core/bank.smoke.test.ts
 *
 * Prints no secret. Writes to the `e2e` Owner's bank only.
 */
import { expect, it } from "vitest";
import { createMCPClient } from "@ai-sdk/mcp";
import { makePool } from "./db";
import { runRead, runWrite } from "./engine";
import { MCP_COMMANDS } from "../domain/commands";
import { signBankToken } from "../domain/mcp-token";

const base = process.env.BANK_SMOKE_URL ?? "";
it.skipIf(!base)("the running bank: MCP, outbox, Workflows and the clock", async () => {
  const owner = "e2e" as const;
  const pool = makePool(process.env.BANK_DATABASE_URL ?? (process.env.CLIENT_MANAGER_DATABASE_URL as string), 2);
  const e2e = { "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "" };

  const read = async (name: string, input: unknown = {}) => {
    const q = `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const response = await fetch(`${base}/api/bank/read/${name}${q}`, { headers: e2e });
    if (!response.ok) throw new Error(`${name}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
    expect(ok, label).toBe(true);
  };

  await read("get_overview");
  const staff = await pool<{ id: string; key: string; name: string; title: string; role: "teller" | "supervisor" | "compliance"; initials: string }[]>`
    select id, key, name, title, role, initials from bank.staff where owner = ${owner}`;
  const teller = staff.find((member) => member.role === "teller");
  if (!teller) throw new Error("No teller");
  const actor = { owner, staff: teller, via: "app" as const };

  const token = signBankToken(
    { kind: "e2e", owner, staffId: teller.id, visitor: "e2e", via: "mcp", exp: Math.floor(Date.now() / 1000) + 600 },
    process.env.RATE_LIMIT_SALT as string,
  );
  const mcp = await createMCPClient({
    transport: { type: "http", url: `${base}/api/bank/mcp`, headers: { authorization: `Bearer ${token}` } },
  });
  const tools = (await mcp.tools()) as Record<string, { execute: (args: unknown, options: unknown) => Promise<{ structuredContent?: Record<string, unknown>; isError?: boolean; content?: { text?: string }[] }> }>;
  const call = (name: string, args: unknown) => tools[name].execute(args, { toolCallId: crypto.randomUUID(), messages: [] });
  check("MCP lists one tool per command", Object.keys(tools).length === MCP_COMMANDS.length, `${Object.keys(tools).length} tools`);
  check("no tool gives an Approval or confirms a request", !("decide_approval" in tools) && !("confirm_request" in tools));

  const { customers } = (await call("list_customers", {})).structuredContent as { customers: { id: string; name: string }[] };
  const detail = async (name: string) =>
    (await call("get_customer", { customerId: customers.find((item) => item.name === name)?.id })).structuredContent as {
      accounts: { id: string; kind: string; number: string; balance: number }[];
      payees: { id: string; name: string }[];
    };
  const tavi = await detail("Tavi Dunmore");
  const joren = await detail("Joren Pike");
  const from = tavi.accounts.find((item) => item.kind === "current");
  const to = joren.accounts.find((item) => item.kind === "current");
  if (!from || !to) throw new Error("Seed accounts missing");

  const asked = (await call("transfer", { fromAccountId: from.id, toAccountNumber: to.number, amount: 500 })).structuredContent;
  check("a transfer asked for over MCP waits for the person", asked?.status === "needs_confirmation", String(asked?.status));
  const after = (await call("get_account", { accountId: from.id })).structuredContent as { account: { balance: number } };
  check("and moved nothing", after.account.balance === from.balance);
  const bad = await call("transfer", { fromAccountId: from.id, toAccountNumber: "1000000019", amount: 500 });
  check("a mistyped account number is refused", bad.isError === true, bad.content?.[0]?.text?.slice(0, 80));
  const wrong = await fetch(`${base}/api/bank/mcp`, { method: "POST", headers: { authorization: "Bearer tdw_nope.nope", "content-type": "application/json" }, body: "{}" });
  check("a bad bearer is refused", wrong.status === 401, String(wrong.status));
  const none = await fetch(`${base}/api/bank/read/get_overview`);
  check("a read without Access is refused", none.status === 401, String(none.status));

  // A payment through the engine (as the app would), then its Workflow.
  const payee = tavi.payees.find((item) => item.name === "Northquay Flour Co");
  const sent = await runWrite(pool, actor, "pay_payee", { fromAccountId: from.id, payeeId: payee?.id, amount: 120_00 }, { idempotencyKey: crypto.randomUUID() });
  const paymentId = (sent as { result: { paymentId: string; status: string } }).result.paymentId;
  check("a payment to another bank goes to clearing", (sent as { result: { status: string } }).result.status === "clearing");
  await read("get_operations"); // kicks the outbox
  await runWrite(pool, actor, "advance_clock", { days: 2 }, { idempotencyKey: crypto.randomUUID() });
  const status = async () =>
    ((await runRead(pool, actor, "list_payments", {})) as { payments: { id: string; status: string }[] }).payments.find((item) => item.id === paymentId)?.status;
  let settled = false;
  let closed = false;
  for (let attempt = 0; attempt < 60 && !(settled && closed); attempt += 1) {
    const ops = (await read("get_operations")) as { workflows: { kind: string; status: string; runId?: string }[] };
    settled = (await status()) === "settled";
    const overview = (await read("get_overview")) as { bankDate: string; eodThrough: string };
    closed = overview.eodThrough >= new Date(Date.parse(`${overview.bankDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    if (attempt % 5 === 0) console.log(`    … payment ${await status()}, eod through ${overview.eodThrough}, runs: ${ops.workflows.slice(0, 4).map((run) => `${run.kind}=${run.status}`).join(" ")}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  check("the clearing Workflow settled it after the clock moved", settled);
  check("the end-of-day Workflow closed every day crossed", closed);
  const books = (await read("get_trial_balance")) as { balanced: boolean; reconciliation: unknown[]; totalDebits: number };
  check("the trial balance nets to zero and reconciles", books.balanced && books.reconciliation.length === 0, `MRF ${(books.totalDebits / 100).toFixed(2)} each side`);

  await mcp.close();
  await pool.end();
}, 240_000);
