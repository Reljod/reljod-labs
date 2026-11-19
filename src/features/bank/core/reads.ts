import type { Owner } from "@/features/access/domain/owner";
import { type CommandName, commandDef } from "../domain/commands";
import { LIMITS } from "../domain/limits";
import { ruleDef } from "../domain/rules";
import { containsPattern } from "../domain/search";
import type {
  AccountDetail,
  AccountView,
  AlertView,
  ApprovalView,
  AuditPage,
  CardAuthView,
  CardView,
  ConfirmationView,
  CustomerDetail,
  CustomerSummary,
  DisputeView,
  HoldView,
  LedgerEntryView,
  LoanDetail,
  LoanView,
  NotificationView,
  OperationsView,
  OverviewView,
  PayeeView,
  PaymentView,
  RuleHistoryView,
  RulesView,
  SpendingSummary,
  StandingOrderView,
  StatementSummary,
  StatementView,
  TransactionView,
  TrialBalanceView,
  WorkflowRunView,
} from "../domain/views";
import type { Db } from "./db";
import { NotFoundError } from "./errors";
import { loadRulebook, ruleHistory } from "./rulebook";

/**
 * The reads. Every one is scoped to the Owner in its query: an id from
 * another bank finds nothing. Called by the GET routes and by the MCP tools
 * through `runRead` in engine.ts.
 */

const accountColumns = (db: Db) => db`
  a.id, a.customer_id, c.name as customer_name, a.number, a.kind, a.name,
  a.status,
  case when a.normal_side = 'C' then b.credits - b.debits else b.debits - b.credits end as balance,
  b.held,
  case when a.kind in ('current', 'savings')
       then b.credits - b.debits - b.held + a.overdraft_limit
       else 0 end as available,
  a.overdraft_limit, a.rate_bps, a.interest_accrued, a.term_months,
  a.matures_on, a.opened_on, a.closed_on`;

const accountFrom = (db: Db) => db`
  bank.accounts a
  join bank.account_balances b on b.account_id = a.id
  left join bank.customers c on c.id = a.customer_id`;

export async function accountsOf(
  db: Db,
  owner: Owner,
  customerId: string,
): Promise<AccountView[]> {
  return db<AccountView[]>`
    select ${accountColumns(db)} from ${accountFrom(db)}
    where a.owner = ${owner} and a.customer_id = ${customerId} and a.kind <> 'loan'
    order by a.opened_on, a.number`;
}

export async function accountById(
  db: Db,
  owner: Owner,
  accountId: string,
): Promise<AccountView> {
  const [account] = await db<AccountView[]>`
    select ${accountColumns(db)} from ${accountFrom(db)}
    where a.owner = ${owner} and a.id = ${accountId}`;
  if (!account) throw new NotFoundError("That account is not in this bank.");
  return account;
}

export async function accountByNumber(
  db: Db,
  owner: Owner,
  number: string,
): Promise<AccountView | null> {
  const [account] = await db<AccountView[]>`
    select ${accountColumns(db)} from ${accountFrom(db)}
    where a.owner = ${owner} and a.number = ${number}`;
  return account ?? null;
}

const customerColumns = (db: Db) => db`
  c.id, c.number, c.name, c.email, c.occupation, c.kyc_status, c.risk,
  c.is_seed, c.created_at,
  (select count(*)::int from bank.accounts a
    where a.customer_id = c.id and a.kind <> 'loan' and a.status <> 'closed') as accounts,
  coalesce((select sum(b.credits - b.debits)::bigint
    from bank.accounts a join bank.account_balances b on b.account_id = a.id
    where a.customer_id = c.id and a.kind in ('current', 'savings', 'term')), 0) as deposits`;

async function overview(db: Db, owner: Owner): Promise<OverviewView> {
  const [row] = await db<OverviewView[]>`
    select
      k.name as bank_name,
      bank.now(${owner}) as bank_now,
      bank.today(${owner}) as bank_date,
      k.eod_through,
      (k.clock_offset_seconds / 86400)::int as days_ahead,
      (select count(*)::int from bank.customers where owner = ${owner}) as customers,
      (select count(*)::int from bank.accounts
        where owner = ${owner} and kind in ('current', 'savings', 'term') and status <> 'closed') as accounts,
      coalesce((select sum(b.credits - b.debits)::bigint from bank.accounts a
        join bank.account_balances b on b.account_id = a.id
        where a.owner = ${owner} and a.kind in ('current', 'savings', 'term')), 0) as deposits,
      coalesce((select sum(b.debits - b.credits)::bigint from bank.accounts a
        join bank.account_balances b on b.account_id = a.id
        where a.owner = ${owner} and a.kind = 'loan'), 0) as loans_outstanding,
      (select count(*)::int from bank.alerts where owner = ${owner} and status = 'open') as open_alerts,
      (select count(*)::int from bank.approvals where owner = ${owner} and status = 'pending') as pending_approvals,
      (select count(*)::int from bank.confirmations
        where owner = ${owner} and status = 'pending' and expires_at > now()) as pending_confirmations,
      (select count(*)::int from bank.notifications where owner = ${owner} and read_at is null) as unread_notifications,
      (select count(*)::int from bank.workflow_runs
        where owner = ${owner} and status in ('running', 'sleeping', 'waiting')) as active_workflows,
      (select count(*)::int from bank.outbox
        where owner = ${owner} and status in ('pending', 'dispatched')) as outbox_depth
    from bank.banks k where k.owner = ${owner}`;
  if (!row) throw new NotFoundError("This bank has not been opened yet.");
  return row;
}

async function listCustomers(
  db: Db,
  owner: Owner,
  input: { search?: string },
): Promise<{ customers: CustomerSummary[] }> {
  const search = input.search?.trim();
  const customers = await db<CustomerSummary[]>`
    select ${customerColumns(db)} from bank.customers c
    where c.owner = ${owner}
      ${search ? db`and (c.name ilike ${`%${search.replace(/[%_\\]/g, "")}%`} or c.number = ${search.toUpperCase()})` : db``}
    order by c.created_at, c.number
    limit 100`;
  return { customers };
}

const cardColumns = (db: Db) => db`
  k.id, k.customer_id, k.account_id, a.number as account_number, k.last_four,
  k.name_on_card, k.expires_on, k.status, k.per_transaction_limit,
  k.daily_limit, k.online_enabled, k.issued_on`;

const loanColumns = (db: Db) => db`
  l.id, l.customer_id, c.name as customer_name, l.number, l.purpose,
  l.principal, l.rate_bps, l.term_months, l.monthly_payment, l.status,
  coalesce((select b.debits - b.credits from bank.account_balances b
    where b.account_id = l.loan_account_id), 0) as outstanding,
  l.arrears, l.disburse_account_id, l.applied_on, l.disbursed_on,
  (select min(i.due_on) from bank.loan_instalments i
    where i.loan_id = l.id and i.status <> 'paid') as next_due_on`;

const standingOrderColumns = (db: Db) => db`
  s.id, s.from_account_id, fa.number as from_number,
  coalesce(ta.number, p.name || ' (' || p.bank_code || ' ' || p.account_number || ')') as "to",
  s.amount, s.frequency, s.next_run_on, s.ends_on, s.reference, s.status,
  s.runs, s.last_result`;

async function getCustomer(
  db: Db,
  owner: Owner,
  input: { customerId: string },
): Promise<CustomerDetail> {
  const [customer] = await db<CustomerDetail["customer"][]>`
    select ${customerColumns(db)}, c.phone, c.address, c.date_of_birth,
           c.monthly_income, c.kyc_note
    from bank.customers c
    where c.owner = ${owner} and c.id = ${input.customerId}`;
  if (!customer) throw new NotFoundError("That customer is not in this bank.");
  const accounts = await accountsOf(db, owner, customer.id);
  const cards = await db<CardView[]>`
    select ${cardColumns(db)} from bank.cards k
    join bank.accounts a on a.id = k.account_id
    where k.owner = ${owner} and k.customer_id = ${customer.id}
    order by k.created_at`;
  const loans = await db<LoanView[]>`
    select ${loanColumns(db)} from bank.loans l
    join bank.customers c on c.id = l.customer_id
    where l.owner = ${owner} and l.customer_id = ${customer.id}
    order by l.created_at desc`;
  const payees = await db<PayeeView[]>`
    select id, customer_id, name, kind, bank_code, account_number, reference,
           first_paid_on, created_on
    from bank.payees
    where owner = ${owner} and customer_id = ${customer.id} and removed_at is null
    order by created_at`;
  const standingOrders = await db<StandingOrderView[]>`
    select ${standingOrderColumns(db)} from bank.standing_orders s
    join bank.accounts fa on fa.id = s.from_account_id
    left join bank.accounts ta on ta.id = s.to_account_id
    left join bank.payees p on p.id = s.payee_id
    where s.owner = ${owner} and fa.customer_id = ${customer.id}
    order by s.status, s.next_run_on`;
  return { customer, accounts, cards, loans, payees, standingOrders };
}

export async function transactionsOf(
  db: Db,
  owner: Owner,
  input: {
    accountId: string;
    limit?: number;
    beforeId?: number;
    query?: string;
  },
): Promise<TransactionView[]> {
  const limit = input.limit ?? 25;
  return db<TransactionView[]>`
    select * from (
      select p.id, p.entry_id, e.entry_date as date, e.created_at as at,
             e.kind, e.description,
             case when p.direction = a.normal_side then 'in' else 'out' end as direction,
             p.amount,
             sum(case when p.direction = a.normal_side then p.amount else -p.amount end)
               over (order by p.id)::bigint as balance_after,
             exists (select 1 from bank.disputes d
               where d.entry_id = p.entry_id and d.account_id = p.account_id) as disputed
      from bank.postings p
      join bank.journal_entries e on e.id = p.entry_id
      join bank.accounts a on a.id = p.account_id
      where p.owner = ${owner} and p.account_id = ${input.accountId}
    ) t
    where true
    ${input.beforeId ? db`and t.id < ${input.beforeId}` : db``}
    ${
      // Filtered outside the window, so the running balance stays the account's.
      input.query
        ? db`and t.description ilike ${containsPattern(input.query)} escape '\\'`
        : db``
    }
    order by t.id desc
    limit ${limit}`;
}

const holdColumns = (db: Db) => db`
  h.id, h.account_id, h.amount, h.kind, h.ref, h.status, h.placed_on, h.expires_on`;

async function getAccount(
  db: Db,
  owner: Owner,
  input: { accountId: string },
): Promise<AccountDetail> {
  const account = await accountById(db, owner, input.accountId);
  const holds = await db<HoldView[]>`
    select ${holdColumns(db)} from bank.holds h
    where h.owner = ${owner} and h.account_id = ${account.id} and h.status = 'active'
    order by h.created_at desc`;
  const transactions = await transactionsOf(db, owner, {
    accountId: account.id,
  });
  const cards = await db<CardView[]>`
    select ${cardColumns(db)} from bank.cards k
    join bank.accounts a on a.id = k.account_id
    where k.owner = ${owner} and k.account_id = ${account.id}
    order by k.created_at`;
  return { account, holds, transactions, cards };
}

async function spendingSummary(
  db: Db,
  owner: Owner,
  input: { accountId: string; months?: number },
): Promise<SpendingSummary> {
  await accountById(db, owner, input.accountId);
  const rows = await db<
    { month: string; kind: string; moneyIn: number; moneyOut: number }[]
  >`
    select to_char(e.entry_date, 'YYYY-MM') as month, e.kind,
           coalesce(sum(p.amount) filter (where p.direction = a.normal_side), 0)::bigint as money_in,
           coalesce(sum(p.amount) filter (where p.direction <> a.normal_side), 0)::bigint as money_out
    from bank.postings p
    join bank.journal_entries e on e.id = p.entry_id
    join bank.accounts a on a.id = p.account_id
    where p.owner = ${owner} and p.account_id = ${input.accountId}
      and e.entry_date > (bank.today(${owner}) - make_interval(months => ${input.months ?? 6}))::date
    group by 1, 2 order by 1, 2`;
  const months = new Map<string, SpendingSummary["months"][number]>();
  for (const row of rows) {
    const month = months.get(row.month) ?? {
      month: row.month,
      moneyIn: 0,
      moneyOut: 0,
      byKind: {},
    };
    month.moneyIn += row.moneyIn;
    month.moneyOut += row.moneyOut;
    month.byKind[row.kind] =
      (month.byKind[row.kind] ?? 0) + row.moneyIn - row.moneyOut;
    months.set(row.month, month);
  }
  return { accountId: input.accountId, months: [...months.values()] };
}

const paymentColumns = (db: Db) => db`
  p.id, p.kind, p.from_account_id, fa.number as from_number, p.to_account_id,
  ta.number as to_number, p.counterparty, p.amount, p.fee, p.reference,
  p.status, p.status_reason, p.submitted_on, p.settles_on, p.settled_on,
  p.entry_id, p.via, p.created_at`;

const paymentFrom = (db: Db) => db`
  bank.payments p
  left join bank.accounts fa on fa.id = p.from_account_id
  left join bank.accounts ta on ta.id = p.to_account_id`;

export async function paymentById(
  db: Db,
  owner: Owner,
  paymentId: string,
): Promise<PaymentView> {
  const [payment] = await db<PaymentView[]>`
    select ${paymentColumns(db)} from ${paymentFrom(db)}
    where p.owner = ${owner} and p.id = ${paymentId}`;
  if (!payment) throw new NotFoundError("That payment is not in this bank.");
  return payment;
}

async function listPayments(
  db: Db,
  owner: Owner,
  input: { customerId?: string; status?: string; limit?: number },
): Promise<{ payments: PaymentView[] }> {
  const payments = await db<PaymentView[]>`
    select ${paymentColumns(db)} from ${paymentFrom(db)}
    where p.owner = ${owner}
      ${input.customerId ? db`and (fa.customer_id = ${input.customerId} or ta.customer_id = ${input.customerId})` : db``}
      ${input.status ? db`and p.status = ${input.status}` : db``}
    order by p.created_at desc
    limit ${input.limit ?? LIMITS.pageSize}`;
  return { payments };
}

async function listCardActivity(
  db: Db,
  owner: Owner,
  input: { cardId: string; limit?: number },
): Promise<{ card: CardView; activity: CardAuthView[] }> {
  const [card] = await db<CardView[]>`
    select ${cardColumns(db)} from bank.cards k
    join bank.accounts a on a.id = k.account_id
    where k.owner = ${owner} and k.id = ${input.cardId}`;
  if (!card) throw new NotFoundError("That card is not in this bank.");
  const activity = await db<CardAuthView[]>`
    select id, card_id, merchant, category, channel, amount, status,
           decline_code, decline_reason, authorised_on, settled_on, created_at
    from bank.card_authorisations
    where owner = ${owner} and card_id = ${card.id}
    order by created_at desc
    limit ${input.limit ?? LIMITS.pageSize}`;
  return { card, activity };
}

async function listLoans(
  db: Db,
  owner: Owner,
  input: { customerId?: string },
): Promise<{ loans: LoanView[] }> {
  const loans = await db<LoanView[]>`
    select ${loanColumns(db)} from bank.loans l
    join bank.customers c on c.id = l.customer_id
    where l.owner = ${owner}
      ${input.customerId ? db`and l.customer_id = ${input.customerId}` : db``}
    order by l.created_at desc limit 100`;
  return { loans };
}

async function getLoan(
  db: Db,
  owner: Owner,
  input: { loanId: string },
): Promise<LoanDetail> {
  const [loan] = await db<Omit<LoanDetail, "schedule">[]>`
    select ${loanColumns(db)}, l.declared_income, l.declared_expenses, l.decision
    from bank.loans l
    join bank.customers c on c.id = l.customer_id
    where l.owner = ${owner} and l.id = ${input.loanId}`;
  if (!loan) throw new NotFoundError("That loan is not in this bank.");
  const schedule = await db<LoanDetail["schedule"]>`
    select n, due_on, principal, interest, payment, balance_after, status, paid_on
    from bank.loan_instalments
    where owner = ${owner} and loan_id = ${loan.id}
    order by n`;
  return { ...loan, schedule };
}

async function listNotifications(
  db: Db,
  owner: Owner,
  input: { customerId?: string; unreadOnly?: boolean; limit?: number },
): Promise<{ notifications: NotificationView[] }> {
  const notifications = await db<NotificationView[]>`
    select n.id, n.customer_id, c.name as customer_name, n.kind, n.title,
           n.body, n.delivered, n.read_at, n.bank_time
    from bank.notifications n
    left join bank.customers c on c.id = n.customer_id
    where n.owner = ${owner}
      ${input.customerId ? db`and n.customer_id = ${input.customerId}` : db``}
      ${input.unreadOnly ? db`and n.read_at is null` : db``}
    order by n.created_at desc
    limit ${input.limit ?? LIMITS.pageSize}`;
  return { notifications };
}

async function listStatements(
  db: Db,
  owner: Owner,
  input: { accountId: string },
): Promise<{ statements: StatementSummary[] }> {
  const statements = await db<StatementSummary[]>`
    select id, account_id, period_start, period_end,
           (body ->> 'closingBalance')::bigint as closing_balance, created_at
    from bank.statements
    where owner = ${owner} and account_id = ${input.accountId}
    order by period_start desc`;
  return { statements };
}

async function getStatement(
  db: Db,
  owner: Owner,
  input: { statementId: string },
): Promise<StatementView> {
  const [statement] = await db<StatementView[]>`
    select id, account_id, period_start, period_end,
           (body ->> 'closingBalance')::bigint as closing_balance, created_at, body
    from bank.statements
    where owner = ${owner} and id = ${input.statementId}`;
  if (!statement)
    throw new NotFoundError("That statement is not in this bank.");
  return statement;
}

async function listDisputes(
  db: Db,
  owner: Owner,
  input: { customerId?: string },
): Promise<{ disputes: DisputeView[] }> {
  const disputes = await db<DisputeView[]>`
    select d.id, d.customer_id, c.name as customer_name, d.account_id,
           a.number as account_number, d.entry_id, d.amount, d.reason,
           d.detail, d.status, d.resolution_note, d.opened_on, d.resolved_on
    from bank.disputes d
    join bank.customers c on c.id = d.customer_id
    join bank.accounts a on a.id = d.account_id
    where d.owner = ${owner}
      ${input.customerId ? db`and d.customer_id = ${input.customerId}` : db``}
    order by d.created_at desc limit 100`;
  return { disputes };
}

const SECTION: Record<string, string> = {
  "1": "asset",
  "2": "liability",
  "3": "equity",
  "4": "income",
  "5": "expense",
};

export async function trialBalance(
  db: Db,
  owner: Owner,
): Promise<TrialBalanceView> {
  const rows = await db<
    {
      accountId: string;
      number: string;
      name: string;
      kind: TrialBalanceView["rows"][number]["kind"];
      glCode: string | null;
      normalSide: "D" | "C";
      debits: number;
      credits: number;
    }[]
  >`
    select a.id as account_id, a.number, a.name, a.kind, a.gl_code,
           a.normal_side, b.debits, b.credits
    from bank.accounts a
    join bank.account_balances b on b.account_id = a.id
    where a.owner = ${owner}
    order by coalesce(a.gl_code, case a.kind when 'loan' then '1300' else '2000' end), a.number`;
  const reconciliation = await db<TrialBalanceView["reconciliation"]>`
    select number, problem, materialised, ledger from bank.reconcile(${owner})`;
  const [counts] = await db<{ entries: number; postings: number }[]>`
    select (select count(*)::int from bank.journal_entries where owner = ${owner}) as entries,
           (select count(*)::int from bank.postings where owner = ${owner}) as postings`;
  const totalDebits = rows.reduce((sum, row) => sum + row.debits, 0);
  const totalCredits = rows.reduce((sum, row) => sum + row.credits, 0);
  return {
    rows: rows.map((row) => ({
      accountId: row.accountId,
      number: row.number,
      name: row.name,
      kind: row.kind,
      section:
        row.kind === "loan"
          ? "asset"
          : row.kind === "gl"
            ? (SECTION[row.glCode?.[0] ?? ""] ?? "other")
            : "liability",
      debits: row.debits,
      credits: row.credits,
      balance:
        row.normalSide === "D"
          ? row.debits - row.credits
          : row.credits - row.debits,
    })),
    totalDebits,
    totalCredits,
    balanced: totalDebits === totalCredits,
    reconciliation,
    entries: counts?.entries ?? 0,
    postings: counts?.postings ?? 0,
  };
}

async function listLedger(
  db: Db,
  owner: Owner,
  input: { limit?: number; beforeId?: number; accountId?: string },
): Promise<{ entries: LedgerEntryView[]; nextBeforeId: number | null }> {
  const limit = input.limit ?? 30;
  const entries = await db<LedgerEntryView[]>`
    select e.id, e.entry_date as date, e.created_at as at, e.kind,
           e.description, e.via, e.reverses_entry_id,
           (select jsonb_agg(jsonb_build_object(
              'accountId', p.account_id, 'number', a.number, 'name', a.name,
              'direction', p.direction, 'amount', p.amount) order by p.id)
            from bank.postings p join bank.accounts a on a.id = p.account_id
            where p.entry_id = e.id) as postings
    from bank.journal_entries e
    where e.owner = ${owner}
      ${input.beforeId ? db`and e.id < ${input.beforeId}` : db``}
      ${input.accountId ? db`and exists (select 1 from bank.postings x where x.entry_id = e.id and x.account_id = ${input.accountId})` : db``}
    order by e.id desc
    limit ${limit + 1}`;
  const page = entries.slice(0, limit);
  return {
    entries: page,
    nextBeforeId: entries.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

async function operations(db: Db, owner: Owner): Promise<OperationsView> {
  const byTopic = await db<{ topic: string; status: string; count: number }[]>`
    select topic, status, count(*)::int as count from bank.outbox
    where owner = ${owner} group by topic, status`;
  const recent = await db<OperationsView["outbox"]["recent"]>`
    select id, topic, status, attempts, created_at from bank.outbox
    where owner = ${owner} order by id desc limit 12`;
  const workflows = await db<WorkflowRunView[]>`
    select id, kind, subject, status, wake_at, steps, detail, started_at, ended_at
    from bank.workflow_runs
    where owner = ${owner}
    order by (status in ('running', 'sleeping', 'waiting')) desc, started_at desc
    limit 40`;
  const holds = await db<OperationsView["holds"]>`
    select ${holdColumns(db)}, a.number as account_number from bank.holds h
    join bank.accounts a on a.id = h.account_id
    where h.owner = ${owner} and h.status = 'active'
    order by h.created_at desc limit 50`;
  const clearing = await db<PaymentView[]>`
    select ${paymentColumns(db)} from ${paymentFrom(db)}
    where p.owner = ${owner} and p.status in ('clearing', 'held')
    order by p.created_at desc limit 50`;
  const count = (status: string) =>
    byTopic
      .filter((row) => row.status === status)
      .reduce((sum, row) => sum + row.count, 0);
  const topics = [...new Set(byTopic.map((row) => row.topic))].sort();
  return {
    outbox: {
      pending: count("pending"),
      dispatched: count("dispatched"),
      done: count("done"),
      failed: count("failed"),
      byTopic: topics.map((topic) => ({
        topic,
        waiting: byTopic
          .filter(
            (row) =>
              row.topic === topic &&
              ["pending", "dispatched"].includes(row.status),
          )
          .reduce((sum, row) => sum + row.count, 0),
        done: byTopic
          .filter((row) => row.topic === topic && row.status === "done")
          .reduce((sum, row) => sum + row.count, 0),
      })),
      recent,
    },
    workflows,
    holds,
    clearing,
  };
}

async function listAlerts(
  db: Db,
  owner: Owner,
  input: { status?: string },
): Promise<{ alerts: AlertView[] }> {
  const alerts = await db<AlertView[]>`
    select al.id, al.customer_id, c.name as customer_name,
           a.number as account_number, al.payment_id,
           case when p.id is null then null else jsonb_build_object(
             'amount', p.amount, 'counterparty', p.counterparty,
             'status', p.status, 'kind', p.kind) end as payment,
           al.severity, al.holding, al.findings, al.summary, al.status,
           s.name as decided_by_name, al.decision_note, al.raised_at,
           al.review_by, al.decided_at
    from bank.alerts al
    left join bank.customers c on c.id = al.customer_id
    left join bank.accounts a on a.id = al.account_id
    left join bank.payments p on p.id = al.payment_id
    left join bank.staff s on s.id = al.decided_by
    where al.owner = ${owner}
      ${input.status ? db`and al.status = ${input.status}` : db``}
    order by (al.status = 'open') desc, al.created_at desc
    limit 100`;
  return { alerts };
}

async function listApprovals(
  db: Db,
  owner: Owner,
  input: { status?: string },
): Promise<{ approvals: ApprovalView[] }> {
  const rows = await db<Omit<ApprovalView, "commandTitle">[]>`
    select ap.id, ap.command, ap.summary, ap.reason, ap.amount,
           ap.requested_by, rs.name as requested_by_name, ap.requested_via,
           ap.status, ds.name as decided_by_name, ap.decision_note,
           ap.created_at, ap.decided_at
    from bank.approvals ap
    left join bank.staff rs on rs.id = ap.requested_by
    left join bank.staff ds on ds.id = ap.decided_by
    where ap.owner = ${owner}
      ${input.status ? db`and ap.status = ${input.status}` : db``}
    order by (ap.status = 'pending') desc, ap.created_at desc
    limit 100`;
  return {
    approvals: rows.map((row) => ({
      ...row,
      commandTitle: commandDef(row.command)?.title ?? row.command,
    })),
  };
}

export async function listConfirmations(
  db: Db,
  owner: Owner,
  input: { sessionId?: string } = {},
): Promise<{ confirmations: ConfirmationView[] }> {
  const rows = await db<Omit<ConfirmationView, "commandTitle">[]>`
    select id, command, summary, requested_via, staff_id, session_id,
           case when status = 'pending' and expires_at <= now() then 'expired' else status end as status,
           result ->> 'message' as result_message, created_at, expires_at
    from bank.confirmations
    where owner = ${owner}
      ${input.sessionId ? db`and session_id = ${input.sessionId}` : db``}
    order by created_at desc
    limit 50`;
  return {
    confirmations: rows.map((row) => ({
      ...row,
      commandTitle: commandDef(row.command)?.title ?? row.command,
    })),
  };
}

async function listAudit(
  db: Db,
  owner: Owner,
  input: {
    beforeId?: number;
    action?: string;
    actorKind?: string;
    sessionId?: string;
    limit?: number;
  },
): Promise<AuditPage> {
  const limit = input.limit ?? LIMITS.auditPageSize;
  const rows = await db<
    (AuditPage["events"][number] & { costUsd: string | null })[]
  >`
    select id, actor_kind, actor_label, via, action, target_kind, target_id,
           summary, detail, session_id, model, input_tokens, output_tokens,
           cost_usd, bank_time, created_at
    from bank.audit_events
    where owner = ${owner}
      ${input.beforeId ? db`and id < ${input.beforeId}` : db``}
      ${input.action ? db`and action = ${input.action}` : db``}
      ${input.actorKind ? db`and actor_kind = ${input.actorKind}` : db``}
      ${input.sessionId ? db`and session_id = ${input.sessionId}` : db``}
    order by id desc
    limit ${limit + 1}`;
  const page = rows.slice(0, limit).map((row) => ({
    ...row,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
  }));
  return {
    events: page,
    nextBeforeId: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

async function listRules(db: Db, owner: Owner): Promise<RulesView> {
  return { rules: Object.values(await loadRulebook(db, owner)) };
}

async function getRuleHistory(
  db: Db,
  owner: Owner,
  input: { ruleId: string },
): Promise<RuleHistoryView> {
  if (!ruleDef(input.ruleId)) throw new NotFoundError("There is no such Rule.");
  return {
    ruleId: input.ruleId,
    versions: await ruleHistory(db, owner, input.ruleId),
  };
}

/** A read handler: the Owner's data for one validated input. */
type ReadHandler = (db: Db, owner: Owner, input: never) => Promise<unknown>;

/**
 * Reads that need more than the database (Growth reads GitHub) are added by
 * the server layer through this registry, so the engine stays free of Next.
 */
export const READS: Partial<Record<CommandName, ReadHandler>> = {
  get_overview: overview,
  list_customers: listCustomers,
  get_customer: getCustomer,
  get_account: getAccount,
  list_transactions: async (
    db,
    owner,
    input: {
      accountId: string;
      limit?: number;
      beforeId?: number;
      query?: string;
    },
  ) => {
    await accountById(db, owner, input.accountId);
    const transactions = await transactionsOf(db, owner, input);
    return { transactions };
  },
  spending_summary: spendingSummary,
  list_payments: listPayments,
  list_card_activity: listCardActivity,
  list_loans: listLoans,
  get_loan: getLoan,
  list_notifications: listNotifications,
  list_statements: listStatements,
  get_statement: getStatement,
  list_disputes: listDisputes,
  get_trial_balance: (db, owner) => trialBalance(db, owner),
  list_ledger: listLedger,
  get_operations: (db, owner) => operations(db, owner),
  list_alerts: listAlerts,
  list_approvals: listApprovals,
  list_confirmations: (db, owner) => listConfirmations(db, owner),
  list_audit: listAudit,
  list_rules: (db, owner) => listRules(db, owner),
  get_rule_history: getRuleHistory,
};

export { overview };
