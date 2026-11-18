import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Owner } from "@/features/access/domain/owner";
import type { WriteOutcome } from "../domain/commands";
import { addDays } from "../domain/dates";
import type { Staff } from "../domain/staff";
import type {
  AccountDetail,
  CustomerDetail,
  CustomerSummary,
  OverviewView,
  TrialBalanceView,
} from "../domain/views";
import type { Actor } from "./actor";
import {
  clearPayment,
  EOD_STEPS,
  eodDates,
  reviewDeadline,
  runEodStep,
} from "./day";
import { makePool, type Pool } from "./db";
import { runRead, runWrite } from "./engine";
import {
  ForbiddenError,
  InsufficientFundsError,
  NotFoundError,
  RuleRefusedError,
  StateError,
} from "./errors";
import { ensureBank, forgetBank } from "./seed";

/**
 * The ledger against a real Postgres with the migration applied. Skipped
 * unless BANK_TEST_DATABASE_URL is set: `pnpm test:bank-db` starts a
 * throwaway Postgres in Docker, applies the migration and runs this.
 */
const url = process.env.BANK_TEST_DATABASE_URL;

const OWNER = "host:00000000-0000-4000-8000-0000000000aa" as Owner;
const OTHER = "host:00000000-0000-4000-8000-0000000000bb" as Owner;

describe.skipIf(!url)("the bank's ledger, on Postgres", () => {
  let pool: Pool;
  let staff: Record<string, Staff>;
  let mara: CustomerDetail;
  let joren: CustomerDetail;
  let tavi: CustomerDetail;

  const as = (
    key: string,
    via: Actor["via"] = "app",
    owner: Owner = OWNER,
  ): Actor => ({
    owner,
    staff: staff[key] as Staff,
    via,
  });
  const read = <T>(
    name: string,
    input: unknown = {},
    actor = as("ines-maro"),
  ) => runRead(pool, actor, name, input) as Promise<T>;
  const write = (
    name: string,
    input: unknown,
    actor = as("ines-maro"),
    key?: string,
  ) =>
    runWrite(pool, actor, name, input, {
      idempotencyKey: key ?? crypto.randomUUID(),
    });
  const done = (outcome: WriteOutcome) => {
    if (outcome.status !== "done")
      throw new Error(`Expected done, got ${outcome.status}`);
    return outcome.result as Record<string, never>;
  };
  const customer = async (name: string) => {
    const { customers } = await read<{ customers: CustomerSummary[] }>(
      "list_customers",
    );
    const found = customers.find((item) => item.name === name);
    return read<CustomerDetail>("get_customer", { customerId: found?.id });
  };
  const current = (detail: CustomerDetail) =>
    detail.accounts.find(
      (account) => account.kind === "current",
    ) as CustomerDetail["accounts"][number];
  const account = async (id: string) =>
    (await read<AccountDetail>("get_account", { accountId: id })).account;
  const books = () => read<TrialBalanceView>("get_trial_balance");
  const expectBooksSound = async () => {
    const tb = await books();
    expect(tb.totalDebits).toBe(tb.totalCredits);
    expect(tb.balanced).toBe(true);
    expect(tb.reconciliation).toEqual([]);
  };

  beforeAll(async () => {
    pool = makePool(url as string, 12);
    await pool`delete from bank.banks where owner in (${OWNER}, ${OTHER})`;
    forgetBank(OWNER);
    forgetBank(OTHER);
    await ensureBank(pool, OWNER);
    await ensureBank(pool, OTHER);
    const rows = await pool<Staff[]>`
      select id, key, name, title, role, initials from bank.staff where owner = ${OWNER}`;
    staff = Object.fromEntries(rows.map((row) => [row.key, row]));
    mara = await customer("Mara Voss");
    joren = await customer("Joren Pike");
    tavi = await customer("Tavi Dunmore");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("seeds a bank whose trial balance nets to zero and reconciles", async () => {
    const tb = await books();
    expect(tb.rows.length).toBeGreaterThan(12);
    expect(tb.entries).toBeGreaterThan(60);
    expect(tb.totalDebits).toBeGreaterThan(5_000_000_00);
    await expectBooksSound();
    // Seeding again changes nothing.
    forgetBank(OWNER);
    await ensureBank(pool, OWNER);
    expect((await books()).entries).toBe(tb.entries);
  });

  it("refuses an entry that does not balance, at commit", async () => {
    const cash = (await books()).rows.find((row) =>
      row.number.startsWith("90"),
    ) as { accountId: string };
    await expect(
      pool.begin(async (tx) => {
        const [entry] = await tx<{ id: number }[]>`
          insert into bank.journal_entries (owner, entry_date, kind, description)
          values (${OWNER}, bank.today(${OWNER}), 'test', 'one-sided') returning id`;
        await tx`
          insert into bank.postings (entry_id, owner, account_id, direction, amount)
          values (${entry?.id ?? 0}, ${OWNER}, ${cash.accountId}, 'D', 100)`;
      }),
    ).rejects.toThrow(/does not balance/);
    await expect(
      pool`select bank.post_entry(${OWNER}, 'test', 'lopsided', ${pool.json([
        { account: cash.accountId, dir: "D", amount: 100 },
        { account: current(mara).id, dir: "C", amount: 99 },
      ])})`,
    ).rejects.toThrow(/does not balance/);
    await expectBooksSound();
  });

  it("refuses UPDATE, DELETE and TRUNCATE on the ledger and the Audit trail, and late postings", async () => {
    const [posting] = await pool<
      { id: number; entryId: number; accountId: string }[]
    >`
      select id, entry_id, account_id from bank.postings where owner = ${OWNER} limit 1`;
    await expect(
      pool`update bank.postings set amount = amount + 1 where id = ${posting?.id ?? 0}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      pool`delete from bank.postings where id = ${posting?.id ?? 0}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      pool`update bank.journal_entries set description = 'x' where id = ${posting?.entryId ?? 0}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      pool`delete from bank.journal_entries where id = ${posting?.entryId ?? 0}`,
    ).rejects.toThrow(/append-only/);
    await expect(pool`truncate bank.postings`).rejects.toThrow();
    await expect(
      pool`update bank.audit_events set summary = 'x' where owner = ${OWNER}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      pool`delete from bank.audit_events where owner = ${OWNER}`,
    ).rejects.toThrow(/append-only/);
    // An entry is sealed when its transaction commits.
    await expect(
      pool`insert into bank.postings (entry_id, owner, account_id, direction, amount)
           values (${posting?.entryId ?? 0}, ${OWNER}, ${posting?.accountId ?? ""}, 'D', 5)`,
    ).rejects.toThrow(/sealed/);
  });

  it("posts a transfer once for one idempotency key", async () => {
    const from = current(mara);
    const to = current(joren);
    const before = await account(from.id);
    const key = crypto.randomUUID();
    const input = {
      fromAccountId: from.id,
      toAccountNumber: to.number,
      amount: 25_00,
      reference: "Lunch",
    };
    const first = await write("transfer", input, as("ines-maro"), key);
    const second = await write("transfer", input, as("ines-maro"), key);
    expect(second).toEqual(first);
    expect(done(first).status).toBe("settled");
    expect((await account(from.id)).balance).toBe(before.balance - 25_00);
    // The same key for a different request is refused, not run.
    await expect(
      write("transfer", { ...input, amount: 26_00 }, as("ines-maro"), key),
    ).rejects.toBeInstanceOf(StateError);
    // Two requests with the same key at the same moment still post once.
    const racedKey = crypto.randomUUID();
    const raced = await Promise.all(
      [1, 2, 3, 4].map(() =>
        write("transfer", input, as("ines-maro"), racedKey),
      ),
    );
    expect(new Set(raced.map((outcome) => done(outcome).paymentId)).size).toBe(
      1,
    );
    expect((await account(from.id)).balance).toBe(before.balance - 50_00);
    await expectBooksSound();
  });

  it("never overdraws under concurrent transfers", async () => {
    const opened = done(
      await write("open_account", {
        customerId: mara.customer.id,
        kind: "current",
        name: "Race",
      }),
    );
    const raceId = opened.accountId as string;
    await write("transfer", {
      fromAccountId: current(mara).id,
      toAccountNumber: opened.number,
      amount: 1_000_00,
    });
    // Thirty transfers of 100 at once against a balance of 1,000.
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        write("transfer", {
          fromAccountId: raceId,
          toAccountNumber: current(joren).number,
          amount: 100_00,
        }),
      ),
    );
    const ok = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(ok.length).toBe(10);
    expect(refused.length).toBe(20);
    for (const result of refused) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
        InsufficientFundsError,
      );
    }
    const after = await account(raceId);
    expect(after.balance).toBe(0);
    expect(after.available).toBe(0);
    await expectBooksSound();
  }, 60_000);

  it("the database itself refuses an overdraft, whatever the application does", async () => {
    const from = current(mara);
    const balance = (await account(from.id)).balance;
    await expect(
      pool`select bank.post_entry(${OWNER}, 'test', 'too much', ${pool.json([
        { account: from.id, dir: "D", amount: balance + 1 },
        { account: current(joren).id, dir: "C", amount: balance + 1 },
      ])})`,
    ).rejects.toMatchObject({ code: "BK001" });
    // And another Owner's account cannot be posted to.
    const other = (await runRead(
      pool,
      { ...as("ines-maro"), owner: OTHER },
      "get_trial_balance",
      {},
    )) as TrialBalanceView;
    await expect(
      pool`select bank.post_entry(${OWNER}, 'test', 'cross-owner', ${pool.json([
        { account: from.id, dir: "D", amount: 1 },
        { account: other.rows[0]?.accountId, dir: "C", amount: 1 },
      ])})`,
    ).rejects.toMatchObject({ code: "BK404" });
  });

  it("scopes every read and write to the Owner", async () => {
    const stranger: Actor = { ...as("ines-maro"), owner: OTHER };
    await expect(
      runRead(pool, stranger, "get_account", { accountId: current(mara).id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runWrite(pool, stranger, "transfer", {
        fromAccountId: current(mara).id,
        toAccountNumber: current(joren).number,
        amount: 1_00,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("holds lower the available balance; settlement posts", async () => {
    const card = joren.cards[0] as CustomerDetail["cards"][number];
    const before = await account(card.accountId);
    const bought = done(
      await write("card_purchase", {
        cardId: card.id,
        merchant: "Greenmarket",
        category: "groceries",
        amount: 40_00,
        channel: "in_store",
      }),
    );
    expect(bought.status).toBe("authorised");
    const held = await account(card.accountId);
    expect(held.balance).toBe(before.balance);
    expect(held.held).toBe(before.held + 40_00);
    expect(held.available).toBe(before.available - 40_00);
    await write("settle_card_purchase", {
      authorisationId: bought.authorisationId,
    });
    const settled = await account(card.accountId);
    expect(settled.balance).toBe(before.balance - 40_00);
    expect(settled.held).toBe(before.held);
    // Over the card's limit: declined with a reason code, nothing held.
    const declined = done(
      await write("card_purchase", {
        cardId: card.id,
        merchant: "Eastwick Motors",
        category: "retail",
        amount: 1_500_00,
        channel: "in_store",
      }),
    );
    expect(declined).toMatchObject({ status: "declined", declineCode: "61" });
    expect((await account(card.accountId)).held).toBe(before.held);
    await expectBooksSound();
  });

  it("maker-checker: a large payment waits for a different supervisor", async () => {
    const from = joren.accounts.find(
      (item) => item.kind === "savings",
    ) as CustomerDetail["accounts"][number];
    const before = await account(from.id);
    const input = {
      fromAccountId: from.id,
      toAccountNumber: current(joren).number,
      amount: 10_000_00,
    };
    const asked = await write("transfer", input, as("tomas-vell"));
    expect(asked.status).toBe("needs_approval");
    expect((await account(from.id)).balance).toBe(before.balance);
    const approvalId = (asked as { approvalId: string }).approvalId;
    const approve = { approvalId, decision: "approve" };
    // Not the maker, not a teller, and never an agent.
    await expect(
      write("decide_approval", approve, as("tomas-vell")),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      write("decide_approval", approve, as("ines-maro")),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      write("decide_approval", approve, as("renske-aldo", "chat")),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      write("decide_approval", approve, as("renske-aldo", "mcp")),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await account(from.id)).balance).toBe(before.balance);
    const approved = done(
      await write("decide_approval", approve, as("renske-aldo")),
    );
    expect(approved.status).toBe("approved");
    expect((await account(from.id)).balance).toBe(before.balance - 10_000_00);
    await expect(
      write("decide_approval", approve, as("renske-aldo")),
    ).rejects.toBeInstanceOf(StateError);
    await expectBooksSound();
  });

  it("a sensitive write from the Teller waits for the person's click", async () => {
    const from = current(mara);
    const before = await account(from.id);
    const input = {
      fromAccountId: from.id,
      toAccountNumber: current(joren).number,
      amount: 12_00,
    };
    const asked = await write("transfer", input, as("ines-maro", "chat"));
    expect(asked.status).toBe("needs_confirmation");
    expect((await account(from.id)).balance).toBe(before.balance);
    const confirmationId = (asked as { confirmationId: string }).confirmationId;
    // The model cannot confirm its own request.
    await expect(
      write(
        "confirm_request",
        { confirmationId, decision: "confirm" },
        as("ines-maro", "chat"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const confirmed = done(
      await write(
        "confirm_request",
        { confirmationId, decision: "confirm" },
        as("ines-maro"),
      ),
    );
    expect(confirmed.status).toBe("confirmed");
    expect((await account(from.id)).balance).toBe(before.balance - 12_00);
    // Reads and harmless writes go straight through for the Teller.
    const credit = await write(
      "receive_credit",
      { accountId: from.id, amount: 5_00, from: "Refund Desk" },
      as("ines-maro", "chat"),
    );
    expect(credit.status).toBe("done");
  });

  it("Roles are enforced by the engine", async () => {
    await expect(
      write(
        "edit_rule",
        { ruleId: "fees.payments", params: { external: 2_00 } },
        as("ines-maro"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      write(
        "decide_kyc",
        { customerId: mara.customer.id, decision: "rejected", note: "test" },
        as("ines-maro"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a payment to another bank clears, settles after the delay, or is returned", async () => {
    const from = current(tavi);
    const good = tavi.payees.find(
      (payee) => payee.name === "Northquay Flour Co",
    );
    const bad = tavi.payees.find((payee) => payee.name === "Old Mill Supplies");
    const start = await account(from.id);
    const sent = done(
      await write("pay_payee", {
        fromAccountId: from.id,
        payeeId: good?.id,
        amount: 300_00,
      }),
    );
    const returned = done(
      await write("pay_payee", {
        fromAccountId: from.id,
        payeeId: bad?.id,
        amount: 200_00,
      }),
    );
    expect(sent.status).toBe("clearing");
    // Debited at once (with the fee for the non-biller), not yet settled.
    expect((await account(from.id)).balance).toBe(
      start.balance - 300_00 - 200_00 - 1_50,
    );
    expect((await clearPayment(pool, OWNER, sent.paymentId)).state).toBe(
      "waiting",
    );
    await write("advance_clock", { days: 3 });
    expect((await clearPayment(pool, OWNER, sent.paymentId)).state).toBe(
      "settled",
    );
    expect((await clearPayment(pool, OWNER, sent.paymentId)).state).toBe(
      "gone",
    );
    expect((await clearPayment(pool, OWNER, returned.paymentId)).state).toBe(
      "returned",
    );
    // The returned payment came back, less the returned-payment fee.
    expect((await account(from.id)).balance).toBe(
      start.balance - 300_00 - 1_50 - 5_00,
    );
    await expectBooksSound();
  });

  it("a risky payment is held, and the review deadline decides it", async () => {
    const from = current(tavi);
    const payee = done(
      await write("add_payee", {
        customerId: tavi.customer.id,
        name: "Brightwater Ovens",
        kind: "person",
        bankCode: "BRWM",
        accountNumber: "81234567",
      }),
    );
    const before = await account(from.id);
    const held = done(
      await write("pay_payee", {
        fromAccountId: from.id,
        payeeId: payee.payeeId,
        amount: 2_500_00,
      }),
    );
    expect(held.status).toBe("held");
    const during = await account(from.id);
    expect(during.balance).toBe(before.balance);
    expect(during.available).toBe(before.available - 2_500_00 - 1_50);
    // A teller may not decide it.
    await expect(
      write("decide_alert", {
        alertId: held.alertId,
        decision: "release",
        note: "looks fine",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await reviewDeadline(pool, OWNER, held.alertId)).state).toBe(
      "waiting",
    );
    await write("advance_clock", { days: 2 });
    expect((await reviewDeadline(pool, OWNER, held.alertId)).state).toBe(
      "timed_out",
    );
    const after = await account(from.id);
    expect(after.available).toBe(before.available);
    expect(after.held).toBe(before.held);
    await expectBooksSound();
  });

  it("the Rules refuse what they say they refuse, and an edit changes the outcome", async () => {
    const from = current(mara);
    await write("receive_credit", {
      accountId: from.id,
      amount: 60_000_00,
      from: "Estate of A. Voss",
    });
    const input = {
      fromAccountId: from.id,
      toAccountNumber: current(joren).number,
      amount: 50_000_01,
    };
    await expect(write("transfer", input)).rejects.toBeInstanceOf(
      RuleRefusedError,
    );
    const edited = await write(
      "edit_rule",
      {
        ruleId: "limits.payments",
        params: { perPayment: 70_000_00, perDay: 200_000_00 },
      },
      as("tomas-vell"),
    );
    expect(done(edited).version).toBe(1);
    // Now allowed by the limit, so it reaches maker-checker instead.
    expect((await write("transfer", input)).status).toBe("needs_approval");
    await write(
      "restore_rule",
      { ruleId: "limits.payments" },
      as("tomas-vell"),
    );
    await expect(write("transfer", input)).rejects.toBeInstanceOf(
      RuleRefusedError,
    );
  });

  it("a loan is decided by Rules, disbursed, and repaid", async () => {
    const declined = done(
      await write("apply_for_loan", {
        customerId: mara.customer.id,
        disburseAccountId: current(mara).id,
        amount: 55_000_00,
        termMonths: 24,
        purpose: "A boat",
        monthlyIncome: 3_400_00,
        monthlyExpenses: 1_800_00,
      }),
    );
    expect(declined.status).toBe("declined");
    const offered = done(
      await write("apply_for_loan", {
        customerId: mara.customer.id,
        disburseAccountId: current(mara).id,
        amount: 6_000_00,
        termMonths: 12,
        purpose: "A new boiler",
        monthlyIncome: 3_400_00,
        monthlyExpenses: 1_800_00,
      }),
    );
    expect(offered.status).toBe("offered");
    await write("accept_loan", { loanId: offered.loanId });
    const { disburseLoan } = await import("./write-cards-loans");
    const today = (await read<OverviewView>("get_overview")).bankDate;
    const before = await account(current(mara).id);
    const paidOut = await pool.begin((tx) =>
      disburseLoan(tx as never, OWNER, offered.loanId, today),
    );
    expect(paidOut.disbursed).toBe(true);
    // Running it again pays nothing out twice.
    const again = await pool.begin((tx) =>
      disburseLoan(tx as never, OWNER, offered.loanId, today),
    );
    expect(again.disbursed).toBe(false);
    expect((await account(current(mara).id)).balance).toBe(
      before.balance + 6_000_00,
    );
    const repaid = done(
      await write("repay_loan", { loanId: offered.loanId, amount: 6_000_00 }),
    );
    // Nothing is due yet, so all of it comes off the principal and clears the loan.
    expect(repaid.instalmentsPaid).toBe(0);
    expect(repaid.closed).toBe(true);
    await expectBooksSound();
  });

  it("end-of-day runs each step once per date and leaves the books sound", async () => {
    await write("advance_clock", { days: 31 });
    await write("advance_clock", { days: 4 });
    const overview = await read<OverviewView>("get_overview");
    const dates = await eodDates(pool, OWNER, addDays(overview.bankDate, -1));
    expect(dates.length).toBeGreaterThanOrEqual(35);
    for (const date of dates) {
      for (const step of EOD_STEPS) await runEodStep(pool, OWNER, date, step);
    }
    const entries = (await books()).entries;
    // A retried step does nothing more.
    const last = dates.at(-1) as string;
    for (const step of EOD_STEPS) await runEodStep(pool, OWNER, last, step);
    expect((await books()).entries).toBe(entries);
    expect((await read<OverviewView>("get_overview")).eodThrough).toBe(last);
    // Joren's next loan instalment was collected and savings interest was paid.
    const loan = (await customer("Joren Pike")).loans[0];
    expect(loan?.status).toBe("active");
    const savings = (await customer("Joren Pike")).accounts.find(
      (item) => item.kind === "savings",
    );
    const paid = await pool`
      select 1 from bank.postings p join bank.journal_entries e on e.id = p.entry_id
      where p.account_id = ${savings?.id ?? ""} and e.kind = 'interest_paid' and e.via = 'workflow'`;
    expect(paid.length).toBeGreaterThan(0);
    await expectBooksSound();
  }, 180_000);

  it("an Owner's whole bank goes when the Owner is purged, and only then", async () => {
    await pool`select access.purge_owner(${OTHER})`;
    const [left] = await pool<{ count: number }[]>`
      select (select count(*) from bank.postings where owner = ${OTHER})
           + (select count(*) from bank.audit_events where owner = ${OTHER})
           + (select count(*) from bank.accounts where owner = ${OTHER}) as count`;
    expect(Number(left?.count)).toBe(0);
    await expectBooksSound();
  });
});
