"use client";

import { useId, useState } from "react";
import type { Finding } from "../../domain/checks";
import { formatMinor, formatMoney, parseMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { CustomerDetail, LoanView } from "../../domain/views";
import { cx, Field, inputClass, segmentClass, segmentsClass } from "../ui";
import { AccountSelect } from "./account-dialogs";
import { rate } from "./format";
import { amountOf, MoneyField, useGate } from "./shared";
import { amountStepUp, WriteDialog } from "./write-dialog";

/** Apply for a loan, accept an offer, repay. */

/** A tick or a cross, drawn: pass is a tick, anything else a cross. */
export function FindingMark({ pass }: { pass: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cx(
        "mt-0.5 size-4 shrink-0",
        pass ? "text-ivy" : "text-seal-red",
      )}
      role="img"
      aria-label={pass ? "Passed" : "Refused"}
    >
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      {pass ? (
        <path
          d="M4 8.5l2.5 2.5L12 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      ) : (
        <path
          d="M5 5l6 6M11 5l-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

/** Every Finding of a decision as a checklist. */
export function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="space-y-1.5" data-testid="bank-loan-findings">
      {findings.map((finding) => (
        <li
          key={`${finding.ruleId}-${finding.message}`}
          className="flex gap-2 text-sm"
        >
          <FindingMark pass={finding.outcome === "pass"} />
          <span className="min-w-0">
            {finding.message}
            <span className="ml-2 font-mono text-[0.65rem] text-ink-muted">
              {finding.ruleId} v{finding.version}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

type ApplyResult = {
  loanId: string;
  number: string;
  status: "offered" | "declined";
  rateBps: number;
  monthlyPayment: number;
  findings: Finding[];
};

const TERMS = [12, 24, 36, 60];

export function ApplyLoanDialog({
  detail,
  onClose,
  onApplied,
}: {
  detail: CustomerDetail;
  onClose: () => void;
  onApplied: (loanId: string) => void;
}) {
  const id = useId();
  const gate = useGate("loan.manage");
  const current = detail.accounts.filter(
    (account) => account.kind === "current" && account.status === "open",
  );
  const [amountText, setAmountText] = useState("");
  const [termText, setTermText] = useState("24");
  const [purpose, setPurpose] = useState("");
  const [incomeText, setIncomeText] = useState(
    formatMinor(detail.customer.monthlyIncome),
  );
  const [expensesText, setExpensesText] = useState("");
  const [payout, setPayout] = useState(current[0]?.id ?? "");
  const amount = amountOf(amountText);
  const term = Number(termText);
  const termOk = Number.isInteger(term) && term >= 1 && term <= 120;
  const income = incomeText.trim() === "" ? 0 : parseMoney(incomeText);
  const expenses = expensesText.trim() === "" ? 0 : parseMoney(expensesText);

  return (
    <WriteDialog<ApplyResult>
      title="Apply for a loan"
      submit="Apply"
      pendingLabel="Deciding…"
      gate={gate}
      wide
      onClose={onClose}
      onDone={(outcome) => {
        if (outcome.status === "done") onApplied(outcome.result.loanId);
      }}
      after={(outcome) =>
        outcome.status === "done" ? (
          <div className="space-y-2">
            {outcome.result.status === "offered" ? (
              <p className="font-mono text-sm">
                {rate(outcome.result.rateBps)} a year ·{" "}
                {formatMoney(outcome.result.monthlyPayment)} a month
              </p>
            ) : null}
            <FindingList findings={outcome.result.findings} />
          </div>
        ) : null
      }
      build={() => {
        if (!amount) return "Give the amount to borrow.";
        if (!termOk) return "The term is 1 to 120 months.";
        if (purpose.trim().length < 2) return "Say what the loan is for.";
        if (income === null) return "Monthly income is an amount.";
        if (expenses === null)
          return "Monthly expenses are an amount, or leave it empty.";
        if (!payout)
          return "A loan pays out into an open current account. Open one first.";
        return {
          name: "apply_for_loan",
          input: {
            customerId: detail.customer.id,
            disburseAccountId: payout,
            amount,
            termMonths: term,
            purpose: purpose.trim(),
            monthlyIncome: income,
            monthlyExpenses: expenses,
          },
        };
      }}
    >
      <p className="text-ink-muted">
        The affordability Rules decide at once: an offer, or a decline with
        every reason.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField
          id={`${id}-amount`}
          label="Amount"
          value={amountText}
          onChange={setAmountText}
          testId="bank-loan-amount"
        />
        <Field
          label="Term (months)"
          htmlFor={`${id}-term`}
          error={termText && !termOk ? "1 to 120 months." : undefined}
        >
          <input
            id={`${id}-term`}
            inputMode="numeric"
            className={cx(inputClass, "font-mono")}
            value={termText}
            aria-invalid={(Boolean(termText) && !termOk) || undefined}
            onChange={(event) => setTermText(event.target.value)}
          />
          <div className={cx(segmentsClass, "mt-1")}>
            {TERMS.map((months) => (
              <button
                key={months}
                type="button"
                aria-pressed={term === months}
                className={segmentClass(term === months)}
                onClick={() => setTermText(String(months))}
              >
                {months}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <Field label="Purpose" htmlFor={`${id}-purpose`}>
        <input
          id={`${id}-purpose`}
          className={inputClass}
          maxLength={80}
          placeholder="A used car"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField
          id={`${id}-income`}
          label="Monthly income"
          value={incomeText}
          onChange={setIncomeText}
          hint="From the customer's file; change it if it has moved."
        />
        <MoneyField
          id={`${id}-expenses`}
          label="Monthly expenses"
          value={expensesText}
          onChange={setExpensesText}
        />
      </div>
      <AccountSelect
        id={`${id}-payout`}
        label="Pay out into"
        accounts={current}
        value={payout}
        onChange={setPayout}
      />
    </WriteDialog>
  );
}

export function AcceptLoanDialog({
  loan,
  onClose,
}: {
  loan: LoanView;
  onClose: () => void;
}) {
  const gate = useGate("loan.manage");
  return (
    <WriteDialog
      title={`Accept loan ${loan.number}`}
      submit="Accept the offer"
      pendingLabel="Accepting…"
      gate={gate}
      onClose={onClose}
      build={() => ({ name: "accept_loan", input: { loanId: loan.id } })}
      stepUp={() =>
        amountStepUp(
          loan.principal,
          <>
            is lent over {loan.termMonths} months at {rate(loan.rateBps)}:{" "}
            {formatMoney(loan.monthlyPayment)} a month. A Workflow pays it out
            and builds the schedule.
          </>,
        )
      }
    >
      <p className="text-ink-muted">
        {formatMoney(loan.principal)} for "{loan.purpose}", {loan.termMonths}{" "}
        months at {rate(loan.rateBps)}: {formatMoney(loan.monthlyPayment)} a
        month.
      </p>
    </WriteDialog>
  );
}

export function RepayLoanDialog({
  loan,
  accounts,
  onClose,
}: {
  loan: LoanView;
  accounts: CustomerDetail["accounts"];
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("loan.manage");
  const due = loan.arrears + loan.monthlyPayment;
  const [amountText, setAmountText] = useState(
    formatMinor(Math.min(due, loan.outstanding)),
  );
  const amount = amountOf(amountText);
  const from = accounts.find(
    (account) => account.id === loan.disburseAccountId,
  );
  return (
    <WriteDialog
      title={`Repay loan ${loan.number}`}
      submit="Repay"
      pendingLabel="Repaying…"
      gate={gate}
      onClose={onClose}
      build={() =>
        amount
          ? { name: "repay_loan", input: { loanId: loan.id, amount } }
          : "Give the amount to repay."
      }
      stepUp={() =>
        amountStepUp(
          amount ?? 0,
          <>
            leaves{" "}
            {from
              ? `${from.name} (${formatAccountNumber(from.number)})`
              : "the repayment account"}{" "}
            towards loan {loan.number}.
          </>,
        )
      }
    >
      <p className="text-ink-muted">
        What is due is paid first (arrears, then the next instalment); the rest
        comes off the principal.
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">Outstanding</dt>
        <dd className="text-right font-mono tabular-nums">
          {formatMoney(loan.outstanding)}
        </dd>
        <dt className="text-ink-muted">Arrears</dt>
        <dd className="text-right font-mono tabular-nums">
          {formatMoney(loan.arrears)}
        </dd>
        <dt className="text-ink-muted">Monthly payment</dt>
        <dd className="text-right font-mono tabular-nums">
          {formatMoney(loan.monthlyPayment)}
        </dd>
      </dl>
      <MoneyField
        id={id}
        label="Amount"
        value={amountText}
        onChange={setAmountText}
        testId="bank-loan-repay-amount"
      />
    </WriteDialog>
  );
}
