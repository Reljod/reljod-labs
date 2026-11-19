# Bank (Tidewater Bank): domain language

The fictional Tidewater Bank of the Republic of Meridia. Currency: the Meridian florin (MRF). Play money only. Read this before naming anything in `src/features/bank/`.

## The bank and who acts in it

- **Bank**: one Owner's own Tidewater Bank (`bank.banks`), opened with its seed on first use. Nothing is shared between Owners.
- **Owner**: who the saved data belongs to (Access's term). Every row carries it.
- **Staff member**: a person working at the bank (Ines Maro, Tomas Vell, Renske Aldo, Odile Karn). A visitor is always signed in as one, and may switch. Not a Customer, not a user account.
- **Role**: `teller`, `supervisor` or `compliance`. Decided only by `can(staff, action)` in `domain/permissions.ts`. A Role is the bank's own control (maker-checker), not a security boundary between visitors.
- **Customer**: someone who banks here (Mara Voss, Joren Pike). Has a **KYC status**: `pending`, `verified`, `rejected`.
- **Teller**: the one chat agent. It acts as the Staff member signed in, reaches the bank only through the MCP server, and is not a Staff member itself. (The Role `teller` is a person's job; the Teller with a capital T is the agent.)
- **Client**: an outside MCP client (Claude) connected with a per-Owner token. Not a Customer.

## The ledger

- **Journal entry** (or **Entry**): one balanced, immutable record of money moving. Has a **kind** and a **bank date**.
- **Posting**: one side of an Entry on one Account: a **debit** (`D`) or a **credit** (`C`) of a whole number of minor units.
- **Account**: a customer account (`current`, `savings`, `term`), a `loan` account (what a customer owes), or a `gl` account (the bank's own books, by **ledger code**).
- **Balance** (posted): what an Account holds, from its Postings. **Held**: money set aside by Holds. **Available**: balance, less held, plus the overdraft limit. Money never leaves past the available balance.
- **Hold**: money set aside without a Posting (a card authorisation, a payment under review). **Captured** when the Posting that uses it is made; **released** or **expired** otherwise.
- **Trial balance**: every Account's debit and credit totals. Debits always equal credits.
- **Reconciliation**: the proof that the materialised balances equal the sum of the Postings.
- **Bank date** / **bank time**: the bank's simulated clock (real time plus an offset per Owner). **Fast-forward** moves it by whole days.
- **End-of-day**: what the bank does when a bank date ends: settle cards, run scheduled payments, collect loans, accrue interest, mature term deposits, month-end statements, prove the books.

## Commands

- **Command**: one thing the bank can be asked to do (`domain/commands.ts`): a **read** or a **write**. The app and the MCP server both run Commands through the same engine. Not a "tool" (that is the MCP word for the same Command) and not a "Job".
- **Idempotency key**: unique per Owner; the same key returns the first result and never runs twice.
- **Sensitive** Command: a write an agent may ask for but not do. It becomes a **Confirmation**.
- **Confirmation**: a sensitive write asked for by the Teller or a Client, waiting for the person's click in the app. Not an Approval.
- **Approval**: maker-checker. A write over a Rule's threshold waits for a supervisor who did not make it. The **maker** asked; the **checker** decides. No tool gives an Approval.
- **Outcome**: what a write answers: `done`, `needs_confirmation` or `needs_approval`. A refusal is an error, not an Outcome.

## Money movement

- **Transfer**: between two Tidewater Accounts; posts at once.
- **Payment**: money to or from another bank. **Payee**: a saved destination at another bank (a person or a **biller**).
- **Clearing**: a Payment has left the Account and waits for the **rail** (the simulated Meridian clearing system). **Settled**: the rail took it on its **settlement date** (the **cut-off** decides which day). **Returned**: the other bank sent it back, with a reason code.
- **Scheduled payment** (stored as a standing order): once, weekly or monthly; End-of-day runs it.
- **Credit** (incoming): money arriving from outside.
- **Reversal**: a mirror Entry that undoes a Transfer or a Credit. **Dispute**: a Customer's challenge to a transaction; **upheld** (refunded from the bank's losses) or **rejected**.

## Cards and loans

- **Card**: a debit card on a current Account, kept as a token and its last four digits. Never a card number.
- **Authorisation**: a card purchase the bank agreed to (a Hold). **Declined** with a **decline code**. **Settled** when the merchant sends it in.
- **Loan**: applied for, **decided** by the affordability Rule (offered or declined), **accepted**, **disbursed**, repaid by **Instalments** on a **schedule**. **Arrears**: missed Instalments.

## Rules and monitoring

- **Rule**: a sentence with **Parameters** and a **Default** (`domain/rules.ts`). An edit is a new **Version** for the Owner. The **Rulebook** is every Rule as it stands for an Owner.
- **Check**: pure code that applies Rules to facts (`domain/checks.ts`). **Finding**: what a Check returns (the Rule, its Version, the outcome, the facts). Only code returns a Finding.
- **Alert**: raised by a fraud or AML Check. A **holding** Alert keeps a Payment in the **review queue** until compliance **releases** or **rejects** it, or the **review deadline** passes.

## Asynchronous work

- **Outbox**: messages written in the transaction of the write they follow (`bank.outbox`). A **topic** names the Workflow.
- **Workflow**: a durable run (Vercel Workflow) started from one Outbox message, exactly once. **Run**: one execution, recorded in `bank.workflow_runs` with its **steps**.
- **Notification**: a message for a Customer, **fanned out** to channels (inbox, and simulated email and push).
- **Statement**: a frozen month of an Account from the ledger.

## Growth

- **Growth request**: something a person asked the bank to learn (a **feature**) or fix (a **bug**), raised in chat. Its text is **untrusted**.
- **Triage**: de-duplicate, apply the Growth Rule, classify with one model call. Code decides.
- **Routine**: the scheduled cloud agent that builds the oldest open Growth issue (`docs/routines/bank-growth.md`).
- **Allowlist**: the only paths a `bank:growth` pull request may touch; enforced by the **guard** in CI.
- **Changelog**: what the bank learned. **Growth rings**: the picture of it.
- **Live**: merged and deployed.
