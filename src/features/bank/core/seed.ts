import { randomBytes } from "node:crypto";
import type { Owner } from "@/features/access/domain/owner";
import { savingsRate, termRate } from "../domain/checks";
import { addDays, addMonths, type BankDate, monthEnd } from "../domain/dates";
import { amortise, monthlyPayment } from "../domain/lending";
import {
  accountNumber,
  cardLastFour,
  customerNumber,
  loanNumber,
} from "../domain/numbers";
import { DEFAULT_RULEBOOK } from "../domain/rules";
import { SEED_STAFF } from "../domain/staff";
import { auditIn } from "./audit";
import { jsonb, type Pool } from "./db";
import { GL, GL_ACCOUNTS, type Posting } from "./ledger";

/**
 * The world every new bank starts with: Tidewater's own books with its share
 * capital, the Staff, and four customers with a few months of history. All
 * of it is fictional (Republic of Meridia), and all of it is the Owner's own
 * copy: nothing here is shared between Owners.
 *
 * Raise SEED_VERSION only with a top-up that adds what is missing; a bank is
 * seeded once.
 */
export const SEED_VERSION = 1;

/** Tidewater's opening share capital: five million florins. */
const CAPITAL = 5_000_000_00;

const seeded = new Set<Owner>();

export function forgetBank(owner: Owner) {
  seeded.delete(owner);
}

type SeedEntry = {
  day: number;
  kind: string;
  description: string;
  postings: Posting[];
};

/**
 * Makes sure the Owner's bank exists and is seeded. Safe to call on every
 * request and from several at once: the bank row is created with `on
 * conflict do nothing`, then locked, and the seed runs in that transaction.
 */
export async function ensureBank(pool: Pool, owner: Owner): Promise<void> {
  if (seeded.has(owner)) return;
  const [existing] = await pool<{ seedVersion: number }[]>`
    select seed_version from bank.banks where owner = ${owner}`;
  if (existing && existing.seedVersion >= SEED_VERSION) {
    seeded.add(owner);
    return;
  }
  await pool.begin(async (tx) => {
    await tx`insert into bank.banks (owner) values (${owner}) on conflict (owner) do nothing`;
    const [bank] = await tx<{ seedVersion: number; today: BankDate }[]>`
      select seed_version, bank.today(owner) as today from bank.banks
      where owner = ${owner} for update`;
    if (!bank || bank.seedVersion >= SEED_VERSION) return;
    const today = bank.today;
    const on = (day: number) => addDays(today, day);
    const id = () => crypto.randomUUID();
    const book = DEFAULT_RULEBOOK;

    await tx`
      insert into bank.staff ${tx(
        SEED_STAFF.map((member) => ({ owner, ...member })),
      )} on conflict (owner, key) do nothing`;

    // The bank's own books.
    const glId = new Map<string, string>();
    const accounts: Record<string, unknown>[] = GL_ACCOUNTS.map(
      (account, index) => {
        const accountId = id();
        glId.set(account.code, accountId);
        return {
          id: accountId,
          owner,
          customer_id: null,
          number: accountNumber("gl", index + 1),
          kind: "gl",
          normal_side: account.normal,
          gl_code: account.code,
          name: account.name,
          rate_bps: 0,
          term_months: null,
          matures_on: null,
          payout_account_id: null,
          opened_on: on(-90),
        };
      },
    );
    const cash = glId.get(GL.cash) as string;
    const interestExpense = glId.get(GL.interestExpense) as string;

    const people = [
      {
        key: "mara",
        name: "Mara Voss",
        email: "mara.voss@example.meridia",
        phone: "+60 555 0142",
        address: "14 Saltmarsh Row, Port Calder, Meridia",
        dob: "1989-03-14",
        occupation: "Logistics planner, Harlow & Reed Shipping",
        income: 3_400_00,
        kyc: "verified",
        risk: "standard",
      },
      {
        key: "joren",
        name: "Joren Pike",
        email: "joren.pike@example.meridia",
        phone: "+60 555 0177",
        address: "3 Signal Hill, Northquay, Meridia",
        dob: "1978-11-02",
        occupation: "Track engineer, Meridia Rail Authority",
        income: 4_100_00,
        kyc: "verified",
        risk: "low",
      },
      {
        key: "selin",
        name: "Selin Aro",
        email: "selin.aro@example.meridia",
        phone: "+60 555 0109",
        address: "Flat 6, 220 Lantern Street, Port Calder, Meridia",
        dob: "2001-07-21",
        occupation: "Student",
        income: 900_00,
        kyc: "pending",
        risk: "standard",
      },
      {
        key: "tavi",
        name: "Tavi Dunmore",
        email: "tavi@dunmorebakery.example.meridia",
        phone: "+60 555 0163",
        address: "Dunmore Bakery, 8 Mill Lane, Eastwick, Meridia",
        dob: "1984-01-30",
        occupation: "Owner, Dunmore Bakery",
        income: 6_200_00,
        kyc: "verified",
        risk: "high",
      },
    ] as const;
    const customerId = Object.fromEntries(
      people.map((person) => [person.key, id()]),
    ) as Record<(typeof people)[number]["key"], string>;
    await tx`
      insert into bank.customers ${tx(
        people.map((person, index) => ({
          id: customerId[person.key],
          owner,
          number: customerNumber(index + 1),
          name: person.name,
          email: person.email,
          phone: person.phone,
          address: person.address,
          date_of_birth: person.dob,
          occupation: person.occupation,
          monthly_income: person.income,
          kyc_status: person.kyc,
          risk: person.risk,
          is_seed: true,
          kyc_note:
            person.kyc === "verified"
              ? "Passport and proof of address checked at the Port Calder branch."
              : "",
        })),
      )}`;

    // Customer accounts. Sequences per product, so numbers carry on from here.
    const seq = { current: 0, savings: 0, term: 0, loan: 0 };
    const account = (
      customer: keyof typeof customerId,
      kind: "current" | "savings" | "term" | "loan",
      name: string,
      opened: number,
      extra: Record<string, unknown> = {},
    ) => {
      const accountId = id();
      seq[kind] += 1;
      accounts.push({
        id: accountId,
        owner,
        customer_id: customerId[customer],
        number: accountNumber(kind, seq[kind]),
        kind,
        normal_side: kind === "loan" ? "D" : "C",
        gl_code: null,
        name,
        rate_bps: kind === "savings" ? savingsRate(book) : 0,
        term_months: null,
        matures_on: null,
        payout_account_id: null,
        opened_on: on(opened),
        ...extra,
      });
      return accountId;
    };
    const maraCurrent = account("mara", "current", "Everyday account", -80);
    const maraSavings = account("mara", "savings", "Rainy day savings", -80);
    const jorenCurrent = account("joren", "current", "Everyday account", -85);
    const jorenSavings = account("joren", "savings", "House fund", -85);
    const termOpened = -45;
    const jorenTerm = account(
      "joren",
      "term",
      "6-month term deposit",
      termOpened,
      {
        rate_bps: termRate(book, 6),
        term_months: 6,
        matures_on: addMonths(on(termOpened), 6),
        payout_account_id: jorenSavings,
      },
    );
    const loanRate = 790;
    const loanPrincipal = 8_000_00;
    const loanMonths = 24;
    const disbursedOn = addDays(addMonths(today, -2), -10);
    const jorenLoan = account("joren", "loan", "Loan L000001", 0, {
      rate_bps: loanRate,
      term_months: loanMonths,
      opened_on: disbursedOn,
    });
    const selinCurrent = account("selin", "current", "Everyday account", -6);
    const taviCurrent = account(
      "tavi",
      "current",
      "Dunmore Bakery trading",
      -88,
    );
    await tx`insert into bank.accounts ${tx(accounts)}`;

    // History, as journal entries dated in the past. Each goes through
    // `post_entry`, so each balances and none overdraws.
    const entries: SeedEntry[] = [];
    const add = (
      day: number,
      kind: string,
      description: string,
      debit: string,
      credit: string,
      amount: number,
    ) =>
      entries.push({
        day,
        kind,
        description,
        postings: [
          { account: debit, dir: "D", amount },
          { account: credit, dir: "C", amount },
        ],
      });
    add(
      -90,
      "capital",
      "Share capital paid in",
      cash,
      glId.get(GL.capital) as string,
      CAPITAL,
    );

    // Mara: salary, rent, card spending, a little to savings each month.
    add(-80, "incoming", "Opening deposit", cash, maraCurrent, 2_400_00);
    const spend = [
      ["Greenmarket", 84_20],
      ["Tidewater Ferries", 46_75],
      ["Lumen Electric", 129_99],
      ["Greenmarket", 62_10],
      ["Quay Coffee", 18_50],
      ["Port Calder Books", 34_00],
      ["Greenmarket", 91_45],
      ["Saltmarsh Pharmacy", 22_80],
      ["Tidewater Ferries", 46_75],
      ["Greenmarket", 77_30],
      ["Harbour Cinema", 27_00],
      ["Quay Coffee", 12_40],
    ] as const;
    for (const [index, day] of [-62, -32, -2].entries()) {
      add(
        day,
        "incoming",
        "Harlow & Reed Shipping: salary",
        cash,
        maraCurrent,
        3_400_00,
      );
      add(
        day + 4,
        "payment_out",
        "Calder Lettings: rent",
        maraCurrent,
        cash,
        1_150_00,
      );
      add(
        day + 5,
        "transfer",
        "To Rainy day savings",
        maraCurrent,
        maraSavings,
        400_00,
      );
      if (index === 2) continue;
      for (const [offset, [merchant, amount]] of spend
        .slice(index * 6, index * 6 + 6)
        .entries()) {
        add(
          day + 6 + offset * 4,
          "card_settle",
          `Card: ${merchant}`,
          maraCurrent,
          cash,
          amount,
        );
      }
    }
    add(
      -31,
      "interest_paid",
      "Savings interest",
      interestExpense,
      maraSavings,
      1_07,
    );

    // Joren: salary, a house fund, a term deposit and a loan two instalments in.
    add(-85, "incoming", "Opening deposit", cash, jorenCurrent, 3_000_00);
    add(
      -84,
      "incoming",
      "Transfer in from Northquay Mutual",
      cash,
      jorenSavings,
      17_000_00,
    );
    for (const day of [-70, -40, -10]) {
      add(
        day,
        "incoming",
        "Meridia Rail Authority: salary",
        cash,
        jorenCurrent,
        4_100_00,
      );
      add(
        day + 2,
        "payment_out",
        "Harbour Energy: electricity",
        jorenCurrent,
        cash,
        96_40,
      );
      add(
        day + 3,
        "transfer",
        "To House fund",
        jorenCurrent,
        jorenSavings,
        900_00,
      );
    }
    add(
      termOpened,
      "term_open",
      "To 6-month term deposit",
      jorenSavings,
      jorenTerm,
      5_000_00,
    );
    add(
      -31,
      "interest_paid",
      "Savings interest",
      interestExpense,
      jorenSavings,
      33_12,
    );
    const payment = monthlyPayment(loanPrincipal, loanRate, loanMonths);
    const schedule = amortise(
      loanPrincipal,
      loanRate,
      loanMonths,
      disbursedOn,
      payment,
    );
    const dayOf = (date: BankDate) =>
      Math.round(
        (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      );
    add(
      dayOf(disbursedOn),
      "loan_disbursement",
      "Loan L000001 paid out",
      jorenLoan,
      jorenCurrent,
      loanPrincipal,
    );
    add(
      dayOf(disbursedOn) + 2,
      "payment_out",
      "Eastwick Motors: car",
      jorenCurrent,
      cash,
      7_600_00,
    );
    const paid = schedule.filter((item) => item.dueOn < today).slice(0, 2);
    for (const item of paid) {
      entries.push({
        day: dayOf(item.dueOn),
        kind: "loan_repayment",
        description: `Loan L000001 instalment ${item.n}`,
        postings: [
          { account: jorenCurrent, dir: "D", amount: item.payment },
          { account: jorenLoan, dir: "C", amount: item.principal },
          {
            account: glId.get(GL.loanInterest) as string,
            dir: "C",
            amount: item.interest,
          },
        ],
      });
    }

    // Selin: new, identity pending, a small balance.
    add(-6, "incoming", "Opening deposit", cash, selinCurrent, 350_00);
    add(
      -3,
      "card_settle",
      "Card: Lantern Street Noodles",
      selinCurrent,
      cash,
      11_90,
    );

    // Tavi: a bakery's takings and suppliers.
    add(-88, "incoming", "Opening deposit", cash, taviCurrent, 9_500_00);
    for (const week of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const day = -86 + week * 7;
      add(
        day,
        "incoming",
        "Card takings: Dunmore Bakery",
        cash,
        taviCurrent,
        2_180_00 + ((week * 137) % 400) * 100,
      );
      add(
        day + 2,
        "payment_out",
        "Northquay Flour Co: flour and yeast",
        taviCurrent,
        cash,
        640_00 + ((week * 53) % 90) * 100,
      );
      if (week % 4 === 0)
        add(
          day + 3,
          "payment_out",
          "Eastwick Council: business rates",
          taviCurrent,
          cash,
          410_00,
        );
    }

    entries.sort((a, b) => a.day - b.day);
    await tx`
      select bank.post_entries(${owner}, ${jsonb(
        tx,
        entries.map((entry) => ({
          kind: entry.kind,
          description: entry.description,
          postings: entry.postings,
          opts: { entry_date: on(Math.min(0, entry.day)), via: "seed" },
        })),
      )})`;

    // Payees, cards, the loan and what is scheduled.
    const payee = (
      customer: keyof typeof customerId,
      name: string,
      kind: "person" | "biller",
      bankCode: string,
      number: string,
      paid: boolean,
    ) => {
      const payeeId = id();
      return {
        id: payeeId,
        owner,
        customer_id: customerId[customer],
        name,
        kind,
        bank_code: bankCode,
        account_number: number,
        reference: "",
        first_paid_on: paid ? on(-58) : null,
        created_on: on(-70),
      };
    };
    const calder = payee(
      "mara",
      "Calder Lettings",
      "biller",
      "CLDM",
      "44120871",
      true,
    );
    const payees = [
      calder,
      payee("mara", "Pia Voss", "person", "NRQM", "55028813", false),
      payee("joren", "Harbour Energy", "biller", "HBRM", "70311255", true),
      payee("tavi", "Northquay Flour Co", "biller", "NRQM", "61500342", true),
      // The rail returns payments to an account ending 0000: a visitor can watch a return.
      payee("tavi", "Old Mill Supplies", "person", "ESTM", "30040000", false),
    ];
    await tx`insert into bank.payees ${tx(payees)}`;
    const card = (
      customer: keyof typeof customerId,
      accountId: string,
      name: string,
      n: number,
    ) => ({
      owner,
      customer_id: customerId[customer],
      account_id: accountId,
      token: `tok_${randomBytes(16).toString("hex")}`,
      last_four: cardLastFour(n),
      name_on_card: name.toUpperCase(),
      expires_on: monthEnd(addMonths(today, 30)),
      per_transaction_limit: Number(book["cards.limits"].params.perTransaction),
      daily_limit: Number(book["cards.limits"].params.perDay),
      issued_on: on(-78),
    });
    await tx`
      insert into bank.cards ${tx([
        card("mara", maraCurrent, "Mara Voss", 1),
        card("joren", jorenCurrent, "Joren Pike", 2),
        card("tavi", taviCurrent, "Tavi Dunmore", 3),
      ])}`;
    const loanId = id();
    await tx`
      insert into bank.loans ${tx({
        id: loanId,
        owner,
        customer_id: customerId.joren,
        number: loanNumber(1),
        purpose: "A used car",
        principal: loanPrincipal,
        rate_bps: loanRate,
        term_months: loanMonths,
        monthly_payment: payment,
        declared_income: 4_100_00,
        declared_expenses: 1_900_00,
        status: "active",
        decision: jsonb(tx, { approved: true, findings: [] }),
        loan_account_id: jorenLoan,
        disburse_account_id: jorenCurrent,
        applied_on: addDays(disbursedOn, -1),
        disbursed_on: disbursedOn,
      })}`;
    await tx`
      insert into bank.loan_instalments ${tx(
        schedule.map((item) => ({
          loan_id: loanId,
          owner,
          n: item.n,
          due_on: item.dueOn,
          principal: item.principal,
          interest: item.interest,
          payment: item.payment,
          balance_after: item.balanceAfter,
          status: paid.includes(item) ? "paid" : "due",
          paid_on: paid.includes(item) ? item.dueOn : null,
        })),
      )}`;
    await tx`
      insert into bank.standing_orders ${tx([
        {
          owner,
          from_account_id: maraCurrent,
          to_account_id: null,
          payee_id: calder.id,
          amount: 1_150_00,
          frequency: "monthly",
          next_run_on: on(2),
          reference: "Rent, 14 Saltmarsh Row",
        },
        {
          owner,
          from_account_id: maraCurrent,
          to_account_id: maraSavings,
          payee_id: null,
          amount: 400_00,
          frequency: "monthly",
          next_run_on: on(3),
          reference: "To savings",
        },
      ])}`;
    await tx`
      insert into bank.counters ${tx([
        { owner, name: "customer", value: people.length },
        { owner, name: "account:current", value: seq.current },
        { owner, name: "account:savings", value: seq.savings },
        { owner, name: "account:term", value: seq.term },
        { owner, name: "account:loan", value: seq.loan },
        { owner, name: "card", value: 3 },
        { owner, name: "loan", value: 1 },
      ])} on conflict (owner, name) do nothing`;
    await tx`
      insert into bank.notifications ${tx([
        {
          owner,
          customer_id: customerId.mara,
          kind: "credit",
          title: "You received MRF 3,400.00",
          body: "From Harlow & Reed Shipping: salary.",
          delivered: jsonb(tx, ["inbox", "email", "push"]),
          bank_time: `${on(-2)}T08:05:00Z`,
        },
        {
          owner,
          customer_id: customerId.selin,
          kind: "welcome",
          title: "Welcome to Tidewater Bank",
          body: "We are verifying your identity; until then some limits apply.",
          delivered: jsonb(tx, ["inbox", "email", "push"]),
          bank_time: `${on(-6)}T10:12:00Z`,
        },
      ])}`;
    await tx`
      update bank.banks set seed_version = ${SEED_VERSION}, seeded_at = now(),
             eod_through = ${on(-1)}
      where owner = ${owner}`;
    await auditIn(
      tx,
      { owner, system: "Tidewater Bank" },
      {
        action: "bank.opened",
        summary: `The bank opened with ${people.length} customers, ${entries.length} journal entries of history and MRF 5,000,000.00 of share capital`,
        target: { kind: "bank", id: owner },
        detail: {
          customers: people.length,
          entries: entries.length,
          seedVersion: SEED_VERSION,
        },
      },
    );
  });
  seeded.add(owner);
}
