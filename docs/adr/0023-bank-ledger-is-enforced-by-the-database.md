# 0023. The bank's ledger is enforced by the database, and every command takes one path

Date: 2026-11-19. Status: accepted. Demo: Tidewater Bank (`src/features/bank`).

(The brief gave this demo ADR numbers 0022 to 0024. 0022 was already taken by `0022-sandbox-on-vercel-sandbox.md`, so the bank uses 0023 and 0024.)

## Context

The bank demo has to be built like a bank's backend: money that can never be created, lost or spent twice, whatever the application code does and however many requests arrive at once. It also has two front doors that must not drift apart: a full UI, and a chat agent (the Teller) plus outside MCP clients.

## Decision

**1. Double entry, in the database.** Money moves only as a journal entry with balanced postings (`bank.journal_entries`, `bank.postings`), in integer minor units. The database, not the application, guarantees:

- an entry balances and has at least two postings: a deferred constraint trigger checks it at commit;
- postings can only join an entry in the transaction that created it (the entry records its transaction id), so a sealed entry cannot be added to later;
- entries, postings and audit events refuse `UPDATE`, `DELETE` and `TRUNCATE`. They go only when an Owner's whole bank is purged (the trigger lets a row go once its `bank.banks` row is gone, the same rule as the Harness audit trail, ADR 0018);
- a customer account is never debited past its available balance (posted, less holds, plus the overdraft limit). `bank.post_entry` and `bank.place_hold` lock the balance rows of every account involved, in id order, before they check and write. Row locks, not `SERIALIZABLE`: the lock order makes deadlocks impossible and there is nothing to retry.

Balances are materialised (`bank.account_balances`) for speed, but they move only in the trigger of the posting that moves them, and `bank.reconcile` proves them against the postings. End-of-day refuses to close a day whose books do not reconcile.

**2. One engine for every command.** `domain/commands.ts` is the list of everything the bank can do. `core/engine.ts` runs a command the same way for the app, the Teller and an MCP client: zod validation, the Role (`can`), then one transaction that claims the idempotency key (`bank.begin_command`), applies the Rules under the account locks, posts, writes the Audit event and any outbox message. The MCP server registers one tool per command from the same list, so parity is by construction; `commands.test.ts` fails if a command has no tool, and scans the UI's code for every command it runs.

Two commands are not tools, on purpose: `decide_approval` and `confirm_request`. No tool gives an Approval, and the model cannot confirm its own request.

**3. Rules run in TypeScript inside the transaction; invariants live in SQL.** A handler takes the locks, reads its facts, runs the pure checks (`domain/checks.ts`) and then posts, all in the one transaction. Limits, fees, fraud holds and affordability are Rules (data, ADR 0015) decided by code. What must hold even if that code is wrong (balance, immutability, funds, Owner scope of every account in an entry) is in the migration. We did not write each command as its own PL/pgSQL function: thirty commands in SQL would duplicate the Rules, which are TypeScript, and the invariants do not need it.

**4. Agents propose, people dispose.** A write marked `sensitive` that arrives from the Teller or an MCP client is parked as a Confirmation (a card the person clicks in the app) and is not run. A write over a Rule's threshold is parked as an Approval for a supervisor who did not make it (maker-checker). Both run later as the Staff member who asked, inside a savepoint, so a decision stands even if the command can no longer run.

**5. A transactional outbox feeds Vercel Workflows.** A command writes its message in its own transaction (`bank.outbox`). The dispatcher claims messages with `SKIP LOCKED` and starts one Workflow run per message, keyed on the message id (a start Hook token), so a crash between `start()` and recording the run cannot start a second one. Clearing and settlement, the fraud review deadline, loan disbursement, statements, end-of-day and notification fan-out are Workflows; every step is idempotent (`once()` claims a key in the same transaction as its work).

**6. A simulated clock.** Bank time is real time plus an offset per Owner. Workflows sleep durably until their due bank time; fast-forwarding the clock adds to the offset, owes end-of-day for each date crossed, and wakes the sleepers.

## Consequences

- The concurrency, idempotency and immutability claims are tested against a real Postgres (`pnpm test:bank-db`, Docker), not mocked. That suite is not part of `pnpm test` in CI; the pure domain tests are.
- There is no cron: the outbox is dispatched after every write and whenever Operations or the overview is read. A message whose dispatch failed waits for the next request to that Owner's bank. For a demo that is enough; a real bank would add a sweeper.
- Bank dates are calendar days in UTC and every day is a bank day. No holidays, no time zones, one currency.
- Card numbers do not exist: a card is a random token and four digits. Nothing secret reaches a log, an event or a prompt.
- Renaming a Workflow or step function orphans sleeping runs (conventions.md); treat `server/workflows.ts` names as fixed.
