"use client";

import { type ReactNode, useId, useState } from "react";
import { formatDate } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import type { CustomerDetail } from "../../domain/views";
import { Badge, Button, Field, inputClass } from "../ui";
import { EditCustomerDialog } from "./customer-forms";
import { KYC_LABEL, KYC_TONE, RISK_TONE } from "./format";
import { GateLine, useGate } from "./shared";
import { WriteDialog } from "./write-dialog";

/** The open Customer's name, numbers and standing, and what may be done to their file. */
export function CustomerHeader({
  customer,
}: {
  customer: CustomerDetail["customer"];
}) {
  const [dialog, setDialog] = useState<"edit" | "verified" | "rejected" | null>(
    null,
  );
  const manageGate = useGate("customer.manage");
  const kycGate = useGate("kyc.decide");
  const decided = customer.kycStatus !== "pending";

  return (
    <header
      className="outline-box rounded-sm bg-paper p-4 shadow-hard-sm"
      data-testid="bank-customer-header"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[0.65rem] font-bold text-ink-muted">
            Customer · <span className="font-mono">{customer.number}</span>
          </p>
          <h2
            className="mt-0.5 truncate font-mono text-xl font-bold"
            data-testid="bank-customer-title"
          >
            {customer.name}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={KYC_TONE[customer.kycStatus]}>
              {KYC_LABEL[customer.kycStatus]}
            </Badge>
            <Badge tone={RISK_TONE[customer.risk]}>{customer.risk} risk</Badge>
            {customer.isSeed ? <Badge>Sample</Badge> : null}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Occupation">
              {customer.occupation || "Not given"}
            </Detail>
            <Detail label="Monthly income">
              {formatMoney(customer.monthlyIncome)}
            </Detail>
            <Detail label="Born">
              {customer.dateOfBirth
                ? formatDate(customer.dateOfBirth)
                : "Not on file"}
            </Detail>
            <Detail label="Email">{customer.email}</Detail>
            <Detail label="Phone">{customer.phone || "Not given"}</Detail>
            <Detail label="Address">{customer.address || "Not given"}</Detail>
          </dl>
          {customer.kycNote ? (
            <p className="mt-2 text-xs text-ink-muted">
              Identity note: {customer.kycNote}
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setDialog("edit")}
              disabled={Boolean(manageGate)}
              title={manageGate ?? undefined}
            >
              Edit details
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setDialog("verified")}
              disabled={Boolean(kycGate) || customer.kycStatus === "verified"}
              title={kycGate ?? undefined}
              data-testid="bank-kyc-verify"
            >
              Verify identity
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setDialog("rejected")}
              disabled={Boolean(kycGate) || customer.kycStatus === "rejected"}
              title={kycGate ?? undefined}
              data-testid="bank-kyc-reject"
            >
              Reject identity
            </Button>
          </div>
          <GateLine
            reason={manageGate && `Edit details: ${manageGate}`}
            className="sm:text-right"
          />
          <GateLine
            reason={!decided && kycGate ? `Identity: ${kycGate}` : null}
            className="sm:text-right"
          />
        </div>
      </div>
      {dialog === "edit" ? (
        <EditCustomerDialog
          customer={customer}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "verified" || dialog === "rejected" ? (
        <KycDialog
          customer={customer}
          decision={dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </header>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="eyebrow shrink-0 pt-0.5 text-[0.6rem] font-bold text-ink-muted">
        {label}
      </dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

function KycDialog({
  customer,
  decision,
  onClose,
}: {
  customer: CustomerDetail["customer"];
  decision: "verified" | "rejected";
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("kyc.decide");
  const [note, setNote] = useState(
    decision === "verified" ? "Identity documents checked in branch." : "",
  );
  const verb = decision === "verified" ? "Verify" : "Reject";
  return (
    <WriteDialog
      title={`${verb} ${customer.name}'s identity`}
      submit={`${verb} identity`}
      pendingLabel={decision === "verified" ? "Verifying…" : "Rejecting…"}
      danger={decision === "rejected"}
      gate={gate}
      onClose={onClose}
      build={() => {
        if (decision === "rejected" && note.trim().length < 3)
          return "Say why the identity is rejected.";
        return {
          name: "decide_kyc",
          input: { customerId: customer.id, decision, note: note.trim() },
        };
      }}
    >
      <p className="text-ink-muted">
        {decision === "verified"
          ? "The customer's identity (KYC) becomes verified. Payments and loans check it."
          : "The customer's identity (KYC) becomes rejected. The bank's Rules refuse what needs a verified identity."}
      </p>
      <Field label="Note for the file" htmlFor={id}>
        <textarea
          id={id}
          rows={3}
          maxLength={200}
          className={inputClass}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </WriteDialog>
  );
}
