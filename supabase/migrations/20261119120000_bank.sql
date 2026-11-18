-- Tidewater Bank (the `bank` demo): a retail bank on a double-entry ledger.
-- Decisions: docs/adr/0023-bank-ledger-is-enforced-by-the-database.md and
-- docs/adr/0024-the-bank-grows-itself-through-github.md.
--
-- What the database itself guarantees, whatever the application does:
--   * a journal entry balances (debits = credits, at least two postings),
--     checked at commit by a deferred constraint trigger;
--   * postings can only be added to an entry in the transaction that made it;
--   * entries, postings and audit events refuse UPDATE, DELETE and TRUNCATE
--     (they go only when the whole bank of an Owner is purged);
--   * a customer account is never debited past its available balance
--     (posted - held + overdraft limit): `bank.post_entry` and
--     `bank.place_hold` lock the balance rows first, in id order;
--   * the materialised balance of an account moves only in the transaction
--     of the posting that moves it (a trigger), and `bank.reconcile` proves
--     it against the postings.
-- Money is bigint minor units (cents of a Meridian florin). Never a float.
-- Purely additive: a new schema, new tables, a new bucket.

create schema bank;

-- The bank of one Owner ----------------------------------------------------------

create table bank.banks (
  owner text primary key,
  name text not null default 'Tidewater Bank',
  -- The simulated clock: bank time = now() + this many seconds. Only ever grows.
  clock_offset_seconds bigint not null default 0 check (clock_offset_seconds >= 0),
  -- The last business date whose end-of-day has finished.
  eod_through date,
  seed_version int not null default 0,
  seeded_at timestamptz,
  created_at timestamptz not null default now()
);

insert into access.owned_tables values ('bank.banks') on conflict do nothing;

create function bank.now(p_owner text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() + make_interval(secs => coalesce(
    (select b.clock_offset_seconds from bank.banks b where b.owner = p_owner), 0))
$$;

-- The bank's business date (Meridia keeps UTC).
create function bank.today(p_owner text)
returns date
language sql
stable
set search_path = ''
as $$
  select (bank.now(p_owner) at time zone 'UTC')::date
$$;

create table bank.counters (
  owner text not null references bank.banks (owner) on delete cascade,
  name text not null,
  value bigint not null default 0,
  primary key (owner, name)
);

create function bank.next_seq(p_owner text, p_name text)
returns bigint
language sql
set search_path = ''
as $$
  insert into bank.counters as c (owner, name, value)
  values (p_owner, p_name, 1)
  on conflict (owner, name) do update set value = c.value + 1
  returning value
$$;

create table bank.staff (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  key text not null,
  name text not null,
  title text not null,
  role text not null check (role in ('teller', 'supervisor', 'compliance')),
  initials text not null,
  created_at timestamptz not null default now(),
  unique (owner, key)
);

-- Customers ---------------------------------------------------------------------

create table bank.customers (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  number text not null,
  name text not null,
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  date_of_birth date,
  occupation text not null default '',
  monthly_income bigint not null default 0 check (monthly_income >= 0),
  kyc_status text not null default 'pending'
    check (kyc_status in ('pending', 'verified', 'rejected')),
  kyc_note text not null default '',
  risk text not null default 'standard' check (risk in ('low', 'standard', 'high')),
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner, number)
);
create index customers_owner_idx on bank.customers (owner, created_at);

-- Accounts ----------------------------------------------------------------------
-- Customer accounts (current, savings, term) are liabilities of the bank, a
-- loan account is an asset, and `gl` accounts are the bank's own books.

create table bank.accounts (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  customer_id uuid references bank.customers (id) on delete cascade,
  number text not null,
  kind text not null check (kind in ('current', 'savings', 'term', 'loan', 'gl')),
  -- Which side grows it: liabilities, income and equity are credit-normal.
  normal_side text not null check (normal_side in ('D', 'C')),
  gl_code text,
  name text not null,
  status text not null default 'open' check (status in ('open', 'frozen', 'closed')),
  overdraft_limit bigint not null default 0 check (overdraft_limit >= 0),
  rate_bps int not null default 0 check (rate_bps between 0 and 5000),
  -- Interest not yet a whole cent, in 1/3,650,000ths of a minor unit.
  interest_carry bigint not null default 0,
  -- Interest accrued and not yet paid into the account, minor units.
  interest_accrued bigint not null default 0 check (interest_accrued >= 0),
  term_months int,
  matures_on date,
  payout_account_id uuid references bank.accounts (id) on delete cascade,
  opened_on date not null,
  closed_on date,
  created_at timestamptz not null default now(),
  unique (owner, number),
  unique (owner, gl_code),
  check ((kind = 'gl') = (customer_id is null)),
  check ((kind = 'gl') = (gl_code is not null))
);
create index accounts_customer_idx on bank.accounts (owner, customer_id);

-- Materialised totals. Moved only by the posting trigger and the hold
-- functions, in the same transaction as the write they reflect.
create table bank.account_balances (
  account_id uuid primary key references bank.accounts (id) on delete cascade,
  owner text not null,
  debits bigint not null default 0 check (debits >= 0),
  credits bigint not null default 0 check (credits >= 0),
  held bigint not null default 0 check (held >= 0)
);

create function bank.accounts_open_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into bank.account_balances (account_id, owner) values (new.id, new.owner);
  return new;
end;
$$;

create trigger accounts_open_balance
  after insert on bank.accounts
  for each row execute function bank.accounts_open_balance();

-- The ledger --------------------------------------------------------------------

create table bank.journal_entries (
  id bigint generated always as identity primary key,
  owner text not null references bank.banks (owner) on delete cascade,
  entry_date date not null,
  kind text not null,
  description text not null,
  -- What it belongs to: { paymentId, cardAuthId, loanId, ... }. Ids only.
  ref jsonb not null default '{}'::jsonb,
  reverses_entry_id bigint references bank.journal_entries (id) on delete cascade,
  staff_id uuid,
  via text not null default 'system',
  -- The transaction that wrote it; postings may only be added in the same one.
  txid bigint not null default txid_current(),
  created_at timestamptz not null default now(),
  unique (reverses_entry_id)
);
create index journal_entries_owner_idx on bank.journal_entries (owner, id desc);

create table bank.postings (
  id bigint generated always as identity primary key,
  entry_id bigint not null references bank.journal_entries (id) on delete cascade,
  owner text not null,
  account_id uuid not null references bank.accounts (id) on delete cascade,
  direction text not null check (direction in ('D', 'C')),
  amount bigint not null check (amount > 0 and amount <= 1000000000000)
);
create index postings_account_idx on bank.postings (account_id, id desc);
create index postings_entry_idx on bank.postings (entry_id);

-- A posting joins its entry only in the entry's own transaction, belongs to
-- the same Owner, and moves the materialised balance with it.
create function bank.postings_apply()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry bank.journal_entries;
begin
  select * into v_entry from bank.journal_entries e where e.id = new.entry_id;
  if v_entry.txid <> txid_current() then
    raise exception 'bank.postings: entry % is sealed, postings cannot be added later', new.entry_id
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_entry.owner <> new.owner then
    raise exception 'bank.postings: posting and entry belong to different Owners'
      using errcode = 'integrity_constraint_violation';
  end if;
  update bank.account_balances b
  set debits = b.debits + case when new.direction = 'D' then new.amount else 0 end,
      credits = b.credits + case when new.direction = 'C' then new.amount else 0 end
  where b.account_id = new.account_id and b.owner = new.owner;
  if not found then
    raise exception 'bank.postings: account % is not in this bank', new.account_id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

create trigger postings_apply
  after insert on bank.postings
  for each row execute function bank.postings_apply();

-- Debits = credits, and at least two postings, checked when the transaction
-- commits (so the postings can be inserted after the entry).
create function bank.entry_must_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_debits bigint;
  v_credits bigint;
  v_count int;
begin
  select coalesce(sum(p.amount) filter (where p.direction = 'D'), 0),
         coalesce(sum(p.amount) filter (where p.direction = 'C'), 0),
         count(*)
  into v_debits, v_credits, v_count
  from bank.postings p where p.entry_id = new.id;
  if v_count < 2 or v_debits <> v_credits then
    raise exception 'bank.journal_entries: entry % does not balance (debits %, credits %, % postings)',
      new.id, v_debits, v_credits, v_count
      using errcode = 'integrity_constraint_violation';
  end if;
  return null;
end;
$$;

create constraint trigger journal_entries_balanced
  after insert on bank.journal_entries
  deferrable initially deferred
  for each row execute function bank.entry_must_balance();

-- Append-only: an entry, a posting or an audit event goes only when the
-- Owner's bank does (the purge cascades from bank.banks, whose row is gone
-- by the time the cascade reaches these tables).
create function bank.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from bank.banks b where b.owner = old.owner) then
      return old;
    end if;
  end if;
  raise exception 'bank.% is append-only: % is refused', tg_table_name, tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger journal_entries_no_update before update on bank.journal_entries
  for each row execute function bank.append_only();
create trigger journal_entries_no_delete before delete on bank.journal_entries
  for each row execute function bank.append_only();
create trigger journal_entries_no_truncate before truncate on bank.journal_entries
  for each statement execute function bank.append_only();
create trigger postings_no_update before update on bank.postings
  for each row execute function bank.append_only();
create trigger postings_no_delete before delete on bank.postings
  for each row execute function bank.append_only();
create trigger postings_no_truncate before truncate on bank.postings
  for each statement execute function bank.append_only();

-- Holds: money set aside (a card authorisation, a payment under review). A
-- hold lowers the available balance and posts nothing.
create table bank.holds (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  account_id uuid not null references bank.accounts (id) on delete cascade,
  amount bigint not null check (amount > 0),
  kind text not null check (kind in ('card', 'review', 'approval')),
  ref text not null default '',
  status text not null default 'active'
    check (status in ('active', 'captured', 'released', 'expired')),
  placed_on date not null,
  expires_on date,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index holds_account_idx on bank.holds (account_id) where status = 'active';
create index holds_owner_idx on bank.holds (owner, created_at desc);

-- Locks the balance rows of these accounts (in id order, so two commands
-- never deadlock) and checks every one is the Owner's.
create function bank.lock_accounts(p_owner text, p_accounts uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_wanted int;
  v_locked int;
begin
  select count(distinct a) into v_wanted from unnest(p_accounts) a;
  select count(*) into v_locked from (
    select b.account_id
    from bank.account_balances b
    where b.owner = p_owner and b.account_id = any (p_accounts)
    order by b.account_id
    for update
  ) locked;
  if v_locked <> v_wanted then
    raise exception 'An account in this request is not in this bank'
      using errcode = 'BK404';
  end if;
end;
$$;

-- Available to spend: posted balance, less holds, plus the overdraft limit.
create function bank.available(p_account uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select b.credits - b.debits - b.held + a.overdraft_limit
  from bank.account_balances b
  join bank.accounts a on a.id = b.account_id
  where b.account_id = p_account
$$;

create function bank.place_hold(
  p_owner text,
  p_account uuid,
  p_amount bigint,
  p_kind text,
  p_ref text,
  p_expires date default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_account bank.accounts;
  v_hold uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'A hold needs a positive amount' using errcode = 'BK400';
  end if;
  perform bank.lock_accounts(p_owner, array[p_account]);
  select * into v_account from bank.accounts a where a.id = p_account;
  if v_account.kind not in ('current', 'savings') then
    raise exception 'Holds are placed on current and savings accounts only'
      using errcode = 'BK400';
  end if;
  if v_account.status <> 'open' then
    raise exception 'Account % is %', v_account.number, v_account.status
      using errcode = 'BK002';
  end if;
  if bank.available(p_account) < p_amount then
    raise exception 'Insufficient funds in account %', v_account.number
      using errcode = 'BK001';
  end if;
  insert into bank.holds (owner, account_id, amount, kind, ref, placed_on, expires_on)
  values (p_owner, p_account, p_amount, p_kind, coalesce(p_ref, ''),
          bank.today(p_owner), p_expires)
  returning id into v_hold;
  update bank.account_balances b set held = b.held + p_amount
  where b.account_id = p_account;
  return v_hold;
end;
$$;

-- Ends an active hold (captured by a posting, released, or expired). Returns
-- whether it was still active: ending it twice changes nothing.
create function bank.end_hold(p_owner text, p_hold uuid, p_status text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hold bank.holds;
begin
  if p_status not in ('captured', 'released', 'expired') then
    raise exception 'Unknown hold status %', p_status using errcode = 'BK400';
  end if;
  select * into v_hold from bank.holds h where h.id = p_hold and h.owner = p_owner;
  if not found then
    raise exception 'No such hold' using errcode = 'BK404';
  end if;
  perform bank.lock_accounts(p_owner, array[v_hold.account_id]);
  update bank.holds h set status = p_status, ended_at = now()
  where h.id = p_hold and h.status = 'active';
  if not found then
    return false;
  end if;
  update bank.account_balances b set held = b.held - v_hold.amount
  where b.account_id = v_hold.account_id;
  return true;
end;
$$;

-- The one way money moves. Posts a balanced journal entry.
--   p_postings: [{ "account": uuid, "dir": "D" | "C", "amount": minor units }]
--   p_opts:
--     capture_hold  uuid   end this hold as captured before the funds check
--     force         bool   skip the available-funds check (bank-initiated
--                          entries: a return, a reversal, interest)
--     allow_frozen  bool   debit a frozen account (bank-initiated only)
--     ref           jsonb  ids this entry belongs to
--     reverses      bigint the entry this one reverses (once only)
--     entry_date    date   a value date in the past (the seed's history);
--                          never after the bank's own date
--     staff_id      uuid, via text
create function bank.post_entry(
  p_owner text,
  p_kind text,
  p_description text,
  p_postings jsonb,
  p_opts jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_entry bigint;
  v_debits bigint;
  v_credits bigint;
  v_count int;
  v_force boolean := coalesce((p_opts ->> 'force')::boolean, false);
  v_allow_frozen boolean := coalesce((p_opts ->> 'allow_frozen')::boolean, false);
  v_date date := coalesce((p_opts ->> 'entry_date')::date, bank.today(p_owner));
  r record;
begin
  if v_date > bank.today(p_owner) then
    raise exception 'An entry cannot be dated after the bank''s own date' using errcode = 'BK400';
  end if;
  if jsonb_typeof(p_postings) <> 'array' then
    raise exception 'Postings must be a list' using errcode = 'BK400';
  end if;
  select coalesce(sum((p ->> 'amount')::bigint) filter (where p ->> 'dir' = 'D'), 0),
         coalesce(sum((p ->> 'amount')::bigint) filter (where p ->> 'dir' = 'C'), 0),
         count(*),
         array_agg(distinct (p ->> 'account')::uuid)
  into v_debits, v_credits, v_count, v_ids
  from jsonb_array_elements(p_postings) p;
  if v_count < 2 or v_debits <> v_credits or v_debits <= 0 then
    raise exception 'The entry does not balance (debits %, credits %)', v_debits, v_credits
      using errcode = 'BK400';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_postings) p
    where p ->> 'dir' not in ('D', 'C') or (p ->> 'amount')::bigint <= 0
  ) then
    raise exception 'Every posting needs a side and a positive amount' using errcode = 'BK400';
  end if;

  perform bank.lock_accounts(p_owner, v_ids);

  if p_opts ? 'capture_hold' then
    perform bank.end_hold(p_owner, (p_opts ->> 'capture_hold')::uuid, 'captured');
  end if;

  for r in
    select a.id, a.number, a.kind, a.status, a.matures_on,
           coalesce(sum((p ->> 'amount')::bigint) filter (where p ->> 'dir' = 'D'), 0) as debit,
           coalesce(sum((p ->> 'amount')::bigint) filter (where p ->> 'dir' = 'C'), 0) as credit
    from jsonb_array_elements(p_postings) p
    join bank.accounts a on a.id = (p ->> 'account')::uuid
    group by a.id
  loop
    if r.status = 'closed' then
      raise exception 'Account % is closed', r.number using errcode = 'BK002';
    end if;
    if r.kind in ('current', 'savings', 'term') and r.debit > r.credit then
      if r.status = 'frozen' and not v_allow_frozen then
        raise exception 'Account % is frozen', r.number using errcode = 'BK002';
      end if;
      if not v_force and bank.available(r.id) < r.debit - r.credit then
        raise exception 'Insufficient funds in account %', r.number using errcode = 'BK001';
      end if;
    end if;
  end loop;

  insert into bank.journal_entries (
    owner, entry_date, kind, description, ref, reverses_entry_id, staff_id, via
  ) values (
    p_owner, v_date, p_kind, left(p_description, 200),
    coalesce(p_opts -> 'ref', '{}'::jsonb),
    (p_opts ->> 'reverses')::bigint,
    (p_opts ->> 'staff_id')::uuid,
    coalesce(p_opts ->> 'via', 'system')
  ) returning id into v_entry;

  insert into bank.postings (entry_id, owner, account_id, direction, amount)
  select v_entry, p_owner, (p ->> 'account')::uuid, p ->> 'dir', (p ->> 'amount')::bigint
  from jsonb_array_elements(p_postings) with ordinality as t (p, n)
  order by n;

  return v_entry;
end;
$$;

-- Posts several entries in order, in one call (the seed's history, an
-- end-of-day batch). Each goes through `post_entry`, so each is checked.
--   p_entries: [{ "kind", "description", "postings", "opts" }]
create function bank.post_entries(p_owner text, p_entries jsonb)
returns bigint[]
language plpgsql
set search_path = ''
as $$
declare
  v_ids bigint[] := '{}';
  e jsonb;
begin
  for e in select value from jsonb_array_elements(p_entries) with ordinality as t (value, n) order by n
  loop
    v_ids := v_ids || bank.post_entry(
      p_owner, e ->> 'kind', e ->> 'description', e -> 'postings',
      coalesce(e -> 'opts', '{}'::jsonb));
  end loop;
  return v_ids;
end;
$$;

-- Proves the materialised balances against the ledger. No rows = reconciled.
create function bank.reconcile(p_owner text)
returns table (
  account_id uuid,
  number text,
  problem text,
  materialised bigint,
  ledger bigint
)
language sql
stable
set search_path = ''
as $$
  with sums as (
    select p.account_id,
           coalesce(sum(p.amount) filter (where p.direction = 'D'), 0) as debits,
           coalesce(sum(p.amount) filter (where p.direction = 'C'), 0) as credits
    from bank.postings p where p.owner = p_owner group by p.account_id
  ),
  held as (
    select h.account_id, sum(h.amount) as held
    from bank.holds h where h.owner = p_owner and h.status = 'active'
    group by h.account_id
  ),
  facts as (
    select a.id, a.number, b.debits, b.credits, b.held,
           coalesce(s.debits, 0) as l_debits, coalesce(s.credits, 0) as l_credits,
           coalesce(h.held, 0) as l_held
    from bank.accounts a
    join bank.account_balances b on b.account_id = a.id
    left join sums s on s.account_id = a.id
    left join held h on h.account_id = a.id
    where a.owner = p_owner
  )
  select f.id, f.number, 'debits', f.debits, f.l_debits from facts f where f.debits <> f.l_debits
  union all
  select f.id, f.number, 'credits', f.credits, f.l_credits from facts f where f.credits <> f.l_credits
  union all
  select f.id, f.number, 'held', f.held, f.l_held from facts f where f.held <> f.l_held
$$;

-- Idempotency -------------------------------------------------------------------
-- A command carries a key, unique per Owner. The first transaction to insert
-- the key runs the command and stores its result with it; a second caller
-- with the same key waits for that transaction, then gets the same result.

create table bank.commands (
  owner text not null references bank.banks (owner) on delete cascade,
  key text not null check (length(key) between 8 and 120),
  command text not null,
  fingerprint text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (owner, key)
);

-- Null: the key is new and now reserved by this transaction; run the command
-- and call `finish_command`. Otherwise the stored result of the first run.
create function bank.begin_command(
  p_owner text,
  p_key text,
  p_command text,
  p_fingerprint text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row bank.commands;
begin
  insert into bank.commands (owner, key, command, fingerprint)
  values (p_owner, p_key, p_command, p_fingerprint)
  on conflict (owner, key) do nothing;
  if found then
    return null;
  end if;
  select * into v_row from bank.commands c where c.owner = p_owner and c.key = p_key;
  if v_row.command <> p_command or v_row.fingerprint <> p_fingerprint then
    raise exception 'That idempotency key was already used for a different request'
      using errcode = 'BK409';
  end if;
  if v_row.result is null then
    raise exception 'That request is still being processed' using errcode = 'BK409';
  end if;
  return v_row.result;
end;
$$;

create function bank.finish_command(p_owner text, p_key text, p_result jsonb)
returns void
language sql
set search_path = ''
as $$
  update bank.commands c set result = p_result
  where c.owner = p_owner and c.key = p_key
$$;

-- A note on foreign keys below: a pointer to an entry, a hold or an account
-- says `on delete cascade` because those rows are only ever deleted by the
-- Owner purge (entries and postings refuse DELETE while the bank exists),
-- and the purge must be able to take every row in any order.

-- Payees, payments, standing orders --------------------------------------------

create table bank.payees (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  customer_id uuid not null references bank.customers (id) on delete cascade,
  name text not null,
  kind text not null default 'person' check (kind in ('person', 'biller')),
  bank_code text not null,
  account_number text not null,
  reference text not null default '',
  first_paid_on date,
  created_on date not null,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index payees_customer_idx on bank.payees (owner, customer_id);

create table bank.standing_orders (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  from_account_id uuid not null references bank.accounts (id) on delete cascade,
  to_account_id uuid references bank.accounts (id) on delete cascade,
  payee_id uuid references bank.payees (id) on delete cascade,
  amount bigint not null check (amount > 0),
  frequency text not null check (frequency in ('once', 'weekly', 'monthly')),
  next_run_on date not null,
  ends_on date,
  reference text not null default '',
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  runs int not null default 0,
  last_result text not null default '',
  created_at timestamptz not null default now(),
  check ((to_account_id is null) <> (payee_id is null))
);
create index standing_orders_due_idx on bank.standing_orders (owner, next_run_on)
  where status = 'active';

create table bank.payments (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  kind text not null check (kind in ('internal', 'external', 'bill', 'incoming')),
  from_account_id uuid references bank.accounts (id) on delete cascade,
  to_account_id uuid references bank.accounts (id) on delete cascade,
  payee_id uuid references bank.payees (id) on delete set null,
  counterparty text not null default '',
  amount bigint not null check (amount > 0),
  fee bigint not null default 0 check (fee >= 0),
  reference text not null default '',
  status text not null check (status in (
    'held', 'clearing', 'settled', 'returned', 'rejected', 'reversed'
  )),
  status_reason text not null default '',
  submitted_on date not null,
  settles_on date,
  settled_on date,
  hold_id uuid references bank.holds (id) on delete cascade,
  entry_id bigint references bank.journal_entries (id) on delete cascade,
  settle_entry_id bigint references bank.journal_entries (id) on delete cascade,
  standing_order_id uuid references bank.standing_orders (id) on delete set null,
  staff_id uuid,
  via text not null default 'app',
  -- When it was made, on the bank's simulated clock.
  bank_time timestamptz not null,
  created_at timestamptz not null default now()
);
create index payments_owner_idx on bank.payments (owner, created_at desc);
create index payments_from_idx on bank.payments (from_account_id, created_at desc);
create index payments_clearing_idx on bank.payments (owner, settles_on) where status = 'clearing';

-- Cards -------------------------------------------------------------------------
-- Never a full card number: a random token and the last four digits.

create table bank.cards (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  customer_id uuid not null references bank.customers (id) on delete cascade,
  account_id uuid not null references bank.accounts (id) on delete cascade,
  token text not null,
  last_four text not null check (last_four ~ '^[0-9]{4}$'),
  name_on_card text not null,
  expires_on date not null,
  status text not null default 'active' check (status in ('active', 'frozen', 'cancelled')),
  per_transaction_limit bigint not null check (per_transaction_limit > 0),
  daily_limit bigint not null check (daily_limit > 0),
  online_enabled boolean not null default true,
  issued_on date not null,
  created_at timestamptz not null default now(),
  unique (owner, token)
);
create index cards_account_idx on bank.cards (owner, account_id);

create table bank.card_authorisations (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  card_id uuid not null references bank.cards (id) on delete cascade,
  account_id uuid not null references bank.accounts (id) on delete cascade,
  merchant text not null,
  category text not null default 'retail',
  channel text not null default 'in_store' check (channel in ('in_store', 'online')),
  amount bigint not null check (amount > 0),
  status text not null check (status in ('authorised', 'declined', 'settled', 'reversed', 'expired')),
  decline_code text,
  decline_reason text,
  hold_id uuid references bank.holds (id) on delete cascade,
  entry_id bigint references bank.journal_entries (id) on delete cascade,
  authorised_on date not null,
  settled_on date,
  created_at timestamptz not null default now()
);
create index card_authorisations_card_idx on bank.card_authorisations (card_id, created_at desc);
create index card_authorisations_open_idx on bank.card_authorisations (owner, authorised_on)
  where status = 'authorised';

-- Loans -------------------------------------------------------------------------

create table bank.loans (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  customer_id uuid not null references bank.customers (id) on delete cascade,
  number text not null,
  purpose text not null default '',
  principal bigint not null check (principal > 0),
  rate_bps int not null check (rate_bps between 0 and 5000),
  term_months int not null check (term_months between 1 and 120),
  monthly_payment bigint not null default 0,
  declared_income bigint not null check (declared_income >= 0),
  declared_expenses bigint not null check (declared_expenses >= 0),
  status text not null check (status in (
    'declined', 'offered', 'accepted', 'active', 'arrears', 'closed', 'withdrawn'
  )),
  -- The Rules' decision: every Finding, the numbers it used, the Rule versions.
  decision jsonb not null default '{}'::jsonb,
  loan_account_id uuid references bank.accounts (id) on delete cascade,
  disburse_account_id uuid not null references bank.accounts (id) on delete cascade,
  arrears bigint not null default 0 check (arrears >= 0),
  applied_on date not null,
  disbursed_on date,
  closed_on date,
  created_at timestamptz not null default now(),
  unique (owner, number)
);
create index loans_customer_idx on bank.loans (owner, customer_id);

create table bank.loan_instalments (
  loan_id uuid not null references bank.loans (id) on delete cascade,
  owner text not null,
  n int not null,
  due_on date not null,
  principal bigint not null,
  interest bigint not null,
  payment bigint not null,
  balance_after bigint not null,
  status text not null default 'due' check (status in ('due', 'paid', 'missed')),
  paid_on date,
  entry_id bigint references bank.journal_entries (id) on delete cascade,
  primary key (loan_id, n)
);
create index loan_instalments_due_idx on bank.loan_instalments (owner, due_on)
  where status <> 'paid';

-- Monitoring, approvals, confirmations, disputes -------------------------------

create table bank.alerts (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  customer_id uuid references bank.customers (id) on delete cascade,
  account_id uuid references bank.accounts (id) on delete cascade,
  payment_id uuid references bank.payments (id) on delete cascade,
  card_authorisation_id uuid references bank.card_authorisations (id) on delete cascade,
  severity text not null check (severity in ('low', 'medium', 'high')),
  -- Holding: the payment waits for a decision. Otherwise it is for the record.
  holding boolean not null default false,
  findings jsonb not null,
  summary text not null,
  status text not null default 'open'
    check (status in ('open', 'released', 'rejected', 'timed_out', 'noted')),
  decided_by uuid,
  decision_note text not null default '',
  raised_at timestamptz not null,
  review_by timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_owner_idx on bank.alerts (owner, created_at desc);
create index alerts_open_idx on bank.alerts (owner) where status = 'open';

-- Maker-checker: a command over a Rule's threshold waits here for a
-- different Staff member with the Role to approve it.
create table bank.approvals (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  command text not null,
  input jsonb not null,
  summary text not null,
  reason text not null,
  amount bigint,
  requested_by uuid not null,
  requested_via text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'failed')),
  decided_by uuid,
  decision_note text not null default '',
  result jsonb,
  session_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (decided_by is null or decided_by <> requested_by)
);
create index approvals_owner_idx on bank.approvals (owner, created_at desc);

-- A sensitive write asked for by the Teller or an MCP client waits here for
-- the person to confirm it in the UI. The model cannot confirm.
create table bank.confirmations (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  command text not null,
  input jsonb not null,
  summary text not null,
  requested_via text not null,
  staff_id uuid not null,
  session_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'declined', 'expired', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz
);
create index confirmations_owner_idx on bank.confirmations (owner, created_at desc);

create table bank.disputes (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  customer_id uuid not null references bank.customers (id) on delete cascade,
  account_id uuid not null references bank.accounts (id) on delete cascade,
  entry_id bigint not null references bank.journal_entries (id) on delete cascade,
  amount bigint not null check (amount > 0),
  reason text not null,
  detail text not null default '',
  status text not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  provisional_entry_id bigint references bank.journal_entries (id) on delete cascade,
  resolution_entry_id bigint references bank.journal_entries (id) on delete cascade,
  resolution_note text not null default '',
  opened_on date not null,
  resolved_on date,
  created_at timestamptz not null default now(),
  unique (owner, entry_id, account_id)
);

create table bank.notifications (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  customer_id uuid references bank.customers (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  -- Channels the fan-out workflow delivered it on: ["inbox", "email", "push"].
  delivered jsonb not null default '[]'::jsonb,
  read_at timestamptz,
  bank_time timestamptz not null,
  created_at timestamptz not null default now()
);
create index notifications_owner_idx on bank.notifications (owner, created_at desc);

create table bank.statements (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  account_id uuid not null references bank.accounts (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  -- The frozen figures: opening and closing balance and every line.
  body jsonb not null,
  created_at timestamptz not null default now(),
  unique (account_id, period_start, period_end)
);

-- Rules as data (ADR 0015) ------------------------------------------------------

create table bank.rule_versions (
  owner text not null references bank.banks (owner) on delete cascade,
  rule_id text not null,
  version int not null,
  enabled boolean not null default true,
  params jsonb not null,
  note text not null default '',
  staff_id uuid,
  staff_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (owner, rule_id, version)
);

-- Outbox and workflow runs ------------------------------------------------------
-- A row is written in the transaction of the ledger write it follows, so a
-- committed write always has its message. The dispatcher claims rows with
-- SKIP LOCKED and starts one workflow per row, once (the start is keyed on
-- the row id).

create table bank.outbox (
  id bigint generated always as identity primary key,
  owner text not null references bank.banks (owner) on delete cascade,
  topic text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'dispatched', 'done', 'failed')),
  attempts int not null default 0,
  run_id text,
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index outbox_pending_idx on bank.outbox (owner, id) where status in ('pending', 'dispatched');

-- Claims up to p_limit messages of an Owner that are pending, or were
-- claimed over a minute ago and never reached their workflow.
create function bank.claim_outbox(p_owner text, p_limit int)
returns setof bank.outbox
language sql
set search_path = ''
as $$
  update bank.outbox o
  set claimed_at = now(), attempts = o.attempts + 1
  where o.id in (
    select c.id from bank.outbox c
    where c.owner = p_owner
      and c.status = 'pending'
      and (c.claimed_at is null or c.claimed_at < now() - interval '60 seconds')
      and c.attempts < 8
    order by c.id
    limit p_limit
    for update skip locked
  )
  returning o.*
$$;

create table bank.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  outbox_id bigint references bank.outbox (id) on delete set null,
  kind text not null,
  subject text not null default '',
  run_id text,
  status text not null default 'running'
    check (status in ('running', 'sleeping', 'waiting', 'completed', 'failed', 'cancelled')),
  -- What it is waiting for, in bank time, when sleeping.
  wake_at timestamptz,
  steps jsonb not null default '[]'::jsonb,
  detail text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index workflow_runs_owner_idx on bank.workflow_runs (owner, started_at desc);
create index workflow_runs_active_idx on bank.workflow_runs (owner)
  where status in ('running', 'sleeping', 'waiting');

-- Chat, audit, rate -------------------------------------------------------------

create table bank.sessions (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  staff_id uuid not null,
  customer_id uuid references bank.customers (id) on delete set null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_owner_idx on bank.sessions (owner, updated_at desc);

create table bank.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references bank.sessions (id) on delete cascade,
  owner text not null,
  role text not null check (role in ('person', 'teller', 'system')),
  content text not null,
  parts jsonb not null default '[]'::jsonb,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);
create index messages_session_idx on bank.messages (session_id, created_at);

create table bank.audit_events (
  id bigint generated always as identity primary key,
  owner text not null references bank.banks (owner) on delete cascade,
  actor_kind text not null check (actor_kind in ('staff', 'teller', 'client', 'system')),
  staff_id uuid,
  actor_label text not null,
  via text not null,
  action text not null,
  target_kind text,
  target_id text,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  session_id uuid,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(12, 6),
  bank_time timestamptz not null,
  created_at timestamptz not null default now()
);
create index audit_events_owner_idx on bank.audit_events (owner, id desc);
create index audit_events_session_idx on bank.audit_events (session_id, id desc)
  where session_id is not null;

create trigger audit_events_no_update before update on bank.audit_events
  for each row execute function bank.append_only();
create trigger audit_events_no_delete before delete on bank.audit_events
  for each row execute function bank.append_only();
create trigger audit_events_no_truncate before truncate on bank.audit_events
  for each statement execute function bank.append_only();

create table bank.rate_hits (
  id bigint generated always as identity primary key,
  owner text not null,
  visitor_hash text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index rate_hits_idx on bank.rate_hits (visitor_hash, kind, created_at desc);

-- Growth: the bank grows itself (ADR 0024) --------------------------------------

create table bank.growth_requests (
  id uuid primary key default gen_random_uuid(),
  owner text not null references bank.banks (owner) on delete cascade,
  kind text not null check (kind in ('feature', 'bug')),
  title text not null,
  -- The person's own words. Untrusted: quoted, never followed.
  want text not null,
  evidence text not null default '',
  session_id uuid,
  staff_id uuid,
  via text not null default 'chat',
  status text not null default 'requested' check (status in (
    'requested', 'triaged', 'refused', 'duplicate', 'issue', 'pr', 'merged', 'live', 'closed'
  )),
  status_note text not null default '',
  triage jsonb not null default '{}'::jsonb,
  duplicate_of uuid references bank.growth_requests (id) on delete set null,
  issue_number int,
  issue_url text,
  pr_number int,
  pr_url text,
  merge_sha text,
  told_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index growth_requests_owner_idx on bank.growth_requests (owner, created_at desc);
create index growth_requests_issue_idx on bank.growth_requests (issue_number)
  where issue_number is not null;

-- Housekeeping ------------------------------------------------------------------

alter table bank.banks enable row level security;
alter table bank.counters enable row level security;
alter table bank.staff enable row level security;
alter table bank.customers enable row level security;
alter table bank.accounts enable row level security;
alter table bank.account_balances enable row level security;
alter table bank.journal_entries enable row level security;
alter table bank.postings enable row level security;
alter table bank.holds enable row level security;
alter table bank.commands enable row level security;
alter table bank.payees enable row level security;
alter table bank.standing_orders enable row level security;
alter table bank.payments enable row level security;
alter table bank.cards enable row level security;
alter table bank.card_authorisations enable row level security;
alter table bank.loans enable row level security;
alter table bank.loan_instalments enable row level security;
alter table bank.alerts enable row level security;
alter table bank.approvals enable row level security;
alter table bank.confirmations enable row level security;
alter table bank.disputes enable row level security;
alter table bank.notifications enable row level security;
alter table bank.statements enable row level security;
alter table bank.rule_versions enable row level security;
alter table bank.outbox enable row level security;
alter table bank.workflow_runs enable row level security;
alter table bank.sessions enable row level security;
alter table bank.messages enable row level security;
alter table bank.audit_events enable row level security;
alter table bank.rate_hits enable row level security;
alter table bank.growth_requests enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema bank from anon, authenticated';
    execute 'revoke all on all tables in schema bank from anon, authenticated';
    execute 'revoke execute on all functions in schema bank from public, anon, authenticated';
  end if;
end;
$$;

-- The private bucket for files a visitor attaches (dispute evidence).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('bank', 'bank', false, 5242880)
    on conflict (id) do nothing;
  end if;
end;
$$;
