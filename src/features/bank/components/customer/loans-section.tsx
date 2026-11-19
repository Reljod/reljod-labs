"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { formatDate } from "../../domain/dates";
import type { CustomerDetail, LoanDetail, LoanView } from "../../domain/views";
import {
  Badge,
  Button,
  cx,
  Empty,
  ErrorNote,
  Loading,
  Panel,
  Spinner,
} from "../ui";
import { useRead } from "../use-bank";
import { INSTALMENT_TONE, LOAN_TONE, rate } from "./format";
import {
  AcceptLoanDialog,
  ApplyLoanDialog,
  FindingList,
  RepayLoanDialog,
} from "./loan-dialogs";
import { Figure, GateLine, Money, useGate } from "./shared";

/** Loans: every application and loan of the Customer, and the selected one in detail. */

type Dialog =
  | { name: "apply" }
  | { name: "accept"; loan: LoanView }
  | { name: "repay"; loan: LoanView };

export function LoansSection({
  detail,
  live,
}: {
  detail: CustomerDetail;
  live: boolean;
}) {
  const gate = useGate("loan.manage");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [picked, setPicked] = useState<{
    customerId: string;
    loanId: string;
  } | null>(null);
  const loans = detail.loans;
  const selectedId =
    picked?.customerId === detail.customer.id &&
    loans.some((loan) => loan.id === picked.loanId)
      ? picked.loanId
      : loans[0]?.id;
  const selected = loans.find((loan) => loan.id === selectedId);
  const close = () => setDialog(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={Boolean(gate)}
          title={gate ?? undefined}
          onClick={() => setDialog({ name: "apply" })}
          data-testid="bank-loan-apply-open"
        >
          Apply for a loan
        </Button>
        <GateLine reason={gate} />
      </div>
      {loans.length === 0 ? (
        <div className="outline-box rounded-sm bg-paper">
          <Empty title="No loans">
            An application is decided at once by the affordability Rules.
          </Empty>
        </div>
      ) : (
        <div
          className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3"
          data-testid="bank-loans"
        >
          {loans.map((loan) => (
            <button
              key={loan.id}
              type="button"
              aria-pressed={loan.id === selectedId}
              onClick={() =>
                setPicked({ customerId: detail.customer.id, loanId: loan.id })
              }
              className={cx(
                "outline-box press flex flex-col gap-2 rounded-sm p-3 text-left shadow-hard-sm",
                loan.id === selectedId
                  ? "bg-morning-haze"
                  : "bg-paper hover:bg-marble",
              )}
              data-testid="bank-loan-card"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-ink-muted">
                  {loan.number}
                </span>
                <Badge
                  tone={LOAN_TONE[loan.status]}
                  dot={loan.status === "accepted"}
                >
                  {loan.status}
                </Badge>
              </span>
              <span className="truncate font-bold">{loan.purpose}</span>
              <span className="grid grid-cols-2 gap-2">
                <Figure label="Principal">
                  <Money minor={loan.principal} />
                </Figure>
                <Figure label="Outstanding" className="text-right">
                  <Money minor={loan.outstanding} className="font-bold" />
                </Figure>
                <Figure label="Rate">{rate(loan.rateBps)}</Figure>
                <Figure label="Monthly" className="text-right">
                  <Money minor={loan.monthlyPayment} />
                </Figure>
              </span>
              <span className="flex flex-wrap gap-x-3 text-[0.7rem] text-ink-muted">
                {loan.arrears > 0 ? (
                  <span className="text-seal-red">
                    Arrears <Money minor={loan.arrears} />
                  </span>
                ) : null}
                {loan.nextDueOn ? (
                  <span>Next due {formatDate(loan.nextDueOn)}</span>
                ) : null}
                <span>{loan.termMonths} months</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {selected ? (
        <LoanDetailPanel
          key={selected.id}
          loan={selected}
          live={live}
          gate={gate}
          onAccept={() => setDialog({ name: "accept", loan: selected })}
          onRepay={() => setDialog({ name: "repay", loan: selected })}
        />
      ) : null}
      {dialog?.name === "apply" ? (
        <ApplyLoanDialog
          detail={detail}
          onClose={close}
          onApplied={(loanId) =>
            setPicked({ customerId: detail.customer.id, loanId })
          }
        />
      ) : null}
      {dialog?.name === "accept" ? (
        <AcceptLoanDialog loan={dialog.loan} onClose={close} />
      ) : null}
      {dialog?.name === "repay" ? (
        <RepayLoanDialog
          loan={dialog.loan}
          accounts={detail.accounts}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

function LoanDetailPanel({
  loan,
  live,
  gate,
  onAccept,
  onRepay,
}: {
  loan: LoanView;
  live: boolean;
  gate: string | null;
  onAccept: () => void;
  onRepay: () => void;
}) {
  // An accepted loan is being paid out by a Workflow: read it every 2 seconds until it is active.
  const disbursing = loan.status === "accepted";
  const read = useRead<LoanDetail>(
    "get_loan",
    { loanId: loan.id },
    { refetchMs: disbursing ? 2_000 : live ? 6_000 : false },
  );
  const reduce = useReducedMotion();
  const view = read.data?.id === loan.id ? read.data : null;
  const status = view?.status ?? loan.status;
  const repayable = status === "active" || status === "arrears";

  return (
    <Panel
      eyebrow={`Loan ${loan.number} · applied ${formatDate(loan.appliedOn)}`}
      title={loan.purpose}
      bodyClassName=""
      actions={
        <>
          {status === "offered" ? (
            <Button
              size="sm"
              variant="primary"
              disabled={Boolean(gate)}
              title={gate ?? undefined}
              onClick={onAccept}
              data-testid="bank-loan-accept"
            >
              Accept offer
            </Button>
          ) : null}
          {repayable ? (
            <Button
              size="sm"
              variant="primary"
              disabled={Boolean(gate)}
              title={gate ?? undefined}
              onClick={onRepay}
              data-testid="bank-loan-repay"
            >
              Repay
            </Button>
          ) : null}
        </>
      }
    >
      {status === "accepted" ? (
        <p
          className="flex items-center gap-2 border-ink/15 border-b px-4 py-2 text-sm"
          aria-live="polite"
        >
          <Spinner /> Paying out: a Workflow disburses the loan and builds the
          schedule.
        </p>
      ) : null}
      {read.error ? (
        <ErrorNote className="m-4" onRetry={() => void read.refetch()}>
          {read.error.message}
        </ErrorNote>
      ) : null}
      {!view ? (
        read.error ? null : (
          <div className="p-4">
            <span className="sr-only" aria-live="polite">
              Loading the loan
            </span>
            <Loading rows={4} />
          </div>
        )
      ) : (
        <div className="grid gap-0 xl:grid-cols-[22rem_1fr]">
          <section
            className="space-y-3 border-ink/15 border-b p-4 xl:border-r xl:border-b-0"
            aria-label="The decision"
          >
            <h4 className="eyebrow text-[0.65rem] font-bold text-ink-muted">
              The decision · {view.decision.approved ? "offered" : "declined"}
            </h4>
            <FindingList findings={view.decision.findings} />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-ink/15 border-t pt-2 text-xs">
              <dt className="text-ink-muted">Declared income</dt>
              <dd className="text-right">
                <Money minor={view.declaredIncome} />
              </dd>
              <dt className="text-ink-muted">Declared expenses</dt>
              <dd className="text-right">
                <Money minor={view.declaredExpenses} />
              </dd>
              {view.disbursedOn ? (
                <>
                  <dt className="text-ink-muted">Paid out</dt>
                  <dd className="text-right">{formatDate(view.disbursedOn)}</dd>
                </>
              ) : null}
            </dl>
          </section>
          <section aria-label="Amortisation schedule" className="min-w-0">
            <h4 className="eyebrow px-4 pt-3 text-[0.65rem] font-bold text-ink-muted">
              Amortisation schedule
            </h4>
            {view.schedule.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-muted">
                {status === "offered"
                  ? "The schedule is built when the offer is accepted and paid out."
                  : "No schedule: this loan was not paid out."}
              </p>
            ) : (
              <div className="hx-scroll max-h-96 overflow-x-auto">
                <table
                  className="w-full min-w-[36rem] text-sm"
                  data-testid="bank-loan-schedule"
                >
                  <thead className="sticky top-0 bg-paper">
                    <tr className="eyebrow border-ink border-b-2 text-left text-[0.6rem] text-ink-muted">
                      <th className="px-3 py-2 font-bold">#</th>
                      <th className="px-3 py-2 font-bold">Due</th>
                      <th className="px-3 py-2 text-right font-bold">
                        Principal
                      </th>
                      <th className="px-3 py-2 text-right font-bold">
                        Interest
                      </th>
                      <th className="px-3 py-2 text-right font-bold">
                        Payment
                      </th>
                      <th className="px-3 py-2 text-right font-bold">
                        Balance after
                      </th>
                      <th className="px-3 py-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/10">
                    {view.schedule.map((row) => (
                      <motion.tr
                        key={row.n}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={cx(
                          row.status === "paid" && "text-ink-muted",
                          row.status === "missed" &&
                            "bg-seal-red/10 text-seal-red",
                        )}
                      >
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {row.n}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">
                          {formatDate(row.dueOn)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Money minor={row.principal} />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Money minor={row.interest} />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Money minor={row.payment} />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Money minor={row.balanceAfter} />
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge tone={INSTALMENT_TONE[row.status]}>
                            {row.status}
                          </Badge>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}
