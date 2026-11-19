import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  COMMANDS,
  commandDef,
  HUMAN_ONLY,
  isSensitive,
  MCP_COMMANDS,
} from "./commands";
import { accountNumber, formatAccountNumber } from "./numbers";
import { ACTIONS } from "./permissions";

// The MCP server module, loaded without Next or a database: only what it
// registers matters here.
vi.mock("server-only", () => ({}));
vi.mock("mcp-handler", () => ({
  createMcpHandler: () => () => new Response(),
  withMcpAuth: (handler: unknown) => handler,
}));
vi.mock("../server/bank", () => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../server/mcp-auth", () => ({
  callerOf: vi.fn(),
  verifyBearer: vi.fn(),
}));
vi.mock("../server/respond", () => ({ refusalOf: () => null }));

type Registered = {
  name: string;
  inputSchema: z.ZodObject;
  annotations?: { readOnlyHint?: boolean };
};

async function mcpTools(): Promise<Registered[]> {
  const { registerBankTools } = await import("../server/mcp");
  const tools: Registered[] = [];
  registerBankTools({
    registerTool: (name: string, config: Omit<Registered, "name">) => {
      tools.push({ name, ...config });
    },
  } as never);
  return tools;
}

/** Every `.ts`/`.tsx` file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

/** The commands the app's own code runs: every `run("x")`, `runCommand("x")`, `useRead("x")` and `readBank("x")`. */
function commandsTheUiUses(): Map<string, string> {
  const used = new Map<string, string>();
  const call =
    /\b(?:run|runCommand|useRead|readBank)(?:<[^()]*>)?\(\s*["'`]([a-z_]+)["'`]/g;
  for (const file of [
    ...sources("src/features/bank/components"),
    ...sources("src/app/demos/bank"),
  ]) {
    for (const match of readFileSync(file, "utf8").matchAll(call)) {
      used.set(match[1] as string, file);
    }
  }
  return used;
}

describe("the UI and the chat are the same bank", () => {
  it("every command is an MCP tool, except the two only a person may do", async () => {
    const tools = (await mcpTools()).map((tool) => tool.name).sort();
    const expected = COMMANDS.map((command) => command.name)
      .filter((name) => !HUMAN_ONLY.includes(name))
      .sort();
    expect(tools).toEqual(expected);
    expect(tools).toEqual(MCP_COMMANDS.map((command) => command.name).sort());
    // No tool gives an Approval or confirms the Teller's own request. If this
    // list grows, it is a decision: say why in the ADR.
    expect([...HUMAN_ONLY].sort()).toEqual([
      "confirm_request",
      "decide_approval",
    ]);
    for (const name of HUMAN_ONLY) expect(tools).not.toContain(name);
  });

  it("every command the app's code runs is in the command list, so it is an MCP tool too", async () => {
    const tools = new Set((await mcpTools()).map((tool) => tool.name));
    const used = commandsTheUiUses();
    // The app must actually be built on commands: this is not vacuous.
    expect(used.size).toBeGreaterThan(30);
    for (const [name, file] of used) {
      expect(
        commandDef(name),
        `${file} runs "${name}", which is not a command`,
      ).toBeDefined();
      if (HUMAN_ONLY.includes(name as never)) continue;
      expect(
        tools.has(name),
        `${file} runs "${name}", which has no MCP tool`,
      ).toBe(true);
    }
  });

  it("every write command the app can run has a handler in the engine", async () => {
    const { hasHandler } = await import("../core/engine");
    for (const command of COMMANDS) {
      if (command.name === "list_growth") continue; // read by server/bank.ts (it reads GitHub too)
      expect(hasHandler(command.name), command.name).toBe(true);
    }
  });

  it("a tool takes exactly its command's fields, plus an idempotency key on a write", async () => {
    for (const tool of await mcpTools()) {
      const def = commandDef(tool.name);
      if (!def) throw new Error(tool.name);
      const own = Object.keys(
        (def.input as unknown as z.ZodObject).shape,
      ).sort();
      const offered = Object.keys(tool.inputSchema.shape).sort();
      expect(offered).toEqual(
        def.kind === "write" ? [...own, "idempotencyKey"].sort() : own,
      );
      expect(tool.annotations?.readOnlyHint).toBe(def.kind === "read");
    }
  });
});

describe("the command list", () => {
  it("has unique names, a known action and a description for each", () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of COMMANDS) {
      expect(ACTIONS).toContain(command.action);
      expect(command.description.length).toBeGreaterThan(20);
      expect(command.name).toMatch(/^[a-z][a-z_]+$/);
    }
  });

  it("marks every money-moving and hard-to-undo write sensitive", () => {
    const always = [
      "transfer",
      "pay_payee",
      "create_standing_order",
      "reverse_payment",
      "open_term_deposit",
      "set_account_status",
      "close_account",
      "set_overdraft",
      "decide_kyc",
      "resolve_dispute",
      "set_card_limits",
      "accept_loan",
      "repay_loan",
      "decide_alert",
      "edit_rule",
      "restore_rule",
      "receive_credit",
      "advance_clock",
    ];
    for (const name of always) {
      const def = commandDef(name);
      expect(def && isSensitive(def, {}), name).toBe(true);
    }
    const card = commandDef("set_card_status");
    expect(card && isSensitive(card, { status: "cancelled" })).toBe(true);
    expect(card && isSensitive(card, { status: "frozen" })).toBe(false);
    // Reads are never sensitive.
    for (const command of COMMANDS.filter((item) => item.kind === "read")) {
      expect(isSensitive(command as never, {})).toBe(false);
    }
  });

  it("validates at the boundary: amounts are whole positive cents, account numbers check out", () => {
    const transfer = commandDef("transfer")?.input as z.ZodType;
    const real = accountNumber("current", 1);
    const typo = `${real.slice(0, 9)}${(Number(real[9]) + 1) % 10}`;
    const base = {
      fromAccountId: "00000000-0000-4000-8000-000000000001",
      toAccountNumber: typo,
      amount: 100,
    };
    expect(transfer.safeParse(base).success).toBe(false); // bad check digit
    // Typed the way the screen shows it, with spaces.
    const good = { ...base, toAccountNumber: formatAccountNumber(real) };
    const parsed = transfer.safeParse(good);
    expect(
      parsed.success &&
        (parsed.data as { toAccountNumber: string }).toAccountNumber,
    ).toBe(real);
    for (const amount of [0, -5, 1.5, 1e13, "100", Number.NaN]) {
      expect(
        transfer.safeParse({ ...good, amount }).success,
        String(amount),
      ).toBe(false);
    }
    expect(
      transfer.safeParse({ ...good, fromAccountId: "1; drop table" }).success,
    ).toBe(false);
    const order = commandDef("create_standing_order")?.input as z.ZodType;
    const schedule = {
      fromAccountId: base.fromAccountId,
      amount: 100,
      frequency: "monthly",
      startOn: "2026-12-01",
    };
    expect(order.safeParse(schedule).success).toBe(false); // neither destination
    expect(
      order.safeParse({
        ...schedule,
        toAccountNumber: real,
        payeeId: base.fromAccountId,
      }).success,
    ).toBe(false); // both
    expect(
      order.safeParse({ ...schedule, toAccountNumber: real }).success,
    ).toBe(true);
    expect(
      order.safeParse({
        ...schedule,
        toAccountNumber: real,
        startOn: "2026-13-01",
      }).success,
    ).toBe(false);
  });
});
