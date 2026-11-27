-- Indexes for the bank's REST reads (`src/features/bank/core/reads.ts` and
-- the chat's Session reads). Each serves a query that filtered or ordered by
-- columns no existing index led with. Additive only: safe for the code
-- already deployed. `create index if not exists`, so it can be run again.

-- get_customer: a customer's cards (`k.owner = ? and k.customer_id = ?`).
-- `cards_account_idx` leads with the account, not the customer.
create index if not exists cards_customer_idx
  on bank.cards (owner, customer_id);

-- get_customer: a customer's standing orders, joined from their accounts
-- (`s.from_account_id = a.id`). The only index was (owner, next_run_on).
create index if not exists standing_orders_from_account_idx
  on bank.standing_orders (from_account_id);

-- get_operations: the outbox by Owner, newest first, and its counts by topic.
-- `outbox_pending_idx` covers only pending and dispatched messages.
create index if not exists outbox_owner_idx
  on bank.outbox (owner, id desc);

-- get_account, list_transactions: `disputed` per posting is
-- `exists (… where d.entry_id = p.entry_id and d.account_id = p.account_id)`,
-- once per row. The unique (owner, entry_id, account_id) leads with the Owner,
-- which that subquery does not name.
create index if not exists disputes_entry_idx
  on bank.disputes (entry_id, account_id);

-- list_disputes: the Owner's disputes, newest first.
create index if not exists disputes_owner_idx
  on bank.disputes (owner, created_at desc);

-- GET /api/bank/sessions/[id] and every Teller turn: the confirmations of one
-- Session (`owner = ? and session_id = ? order by created_at desc`).
create index if not exists confirmations_session_idx
  on bank.confirmations (session_id, created_at desc);
