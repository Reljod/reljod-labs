"use client";

import { useId, useState } from "react";
import { addMonths, formatDate, isBankDate } from "../../domain/dates";
import { formatMinor, parseMoney } from "../../domain/money";
import type { CustomerDetail, OverviewView } from "../../domain/views";
import { cx, Field, inputClass } from "../ui";
import { useRead } from "../use-bank";
import { MoneyField, useGate, WriteDialog } from "./shared";

/** Onboarding a Customer, and changing their details. */

type Contact = {
  email: string;
  phone: string;
  address: string;
  occupation: string;
  income: string;
};

function ContactFields({
  value,
  onChange,
}: {
  value: Contact;
  onChange: (next: Contact) => void;
}) {
  const id = useId();
  const set = (key: keyof Contact) => (event: { target: { value: string } }) =>
    onChange({ ...value, [key]: event.target.value });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" htmlFor={`${id}-email`}>
          <input id={`${id}-email`} type="email" className={inputClass} value={value.email} onChange={set("email")} />
        </Field>
        <Field label="Phone" htmlFor={`${id}-phone`}>
          <input id={`${id}-phone`} type="tel" className={inputClass} value={value.phone} onChange={set("phone")} />
        </Field>
      </div>
      <Field label="Address" htmlFor={`${id}-address`}>
        <input id={`${id}-address`} className={inputClass} value={value.address} onChange={set("address")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Occupation" htmlFor={`${id}-occupation`}>
          <input
            id={`${id}-occupation`}
            className={inputClass}
            value={value.occupation}
            onChange={set("occupation")}
          />
        </Field>
        <MoneyField
          id={`${id}-income`}
          label="Monthly income"
          value={value.income}
          onChange={(income) => onChange({ ...value, income })}
        />
      </div>
    </>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactProblem(value: Contact): string | null {
  if (!EMAIL.test(value.email.trim())) return "Give an email address like name@example.mr.";
  if (!value.phone.trim()) return "Give a phone number.";
  if (!value.address.trim()) return "Give an address.";
  if (!value.occupation.trim()) return "Give an occupation.";
  if (parseMoney(value.income || "0") === null) return "Monthly income is an amount like 3,200.00.";
  return null;
}

export function OpenCustomerDialog({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: (customerId: string) => void;
}) {
  const id = useId();
  const gate = useGate("customer.manage");
  const overview = useRead<OverviewView>("get_overview");
  const bankDate = overview.data?.bankDate ?? new Date().toISOString().slice(0, 10);
  const latestBirth = addMonths(bankDate, -18 * 12);
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [contact, setContact] = useState<Contact>({
    email: "",
    phone: "",
    address: "",
    occupation: "",
    income: "",
  });
  const tooYoung = isBankDate(birth) && birth > latestBirth;

  return (
    <WriteDialog<{ customerId: string; number: string }>
      title="Open a customer"
      submit="Open the customer"
      pendingLabel="Opening…"
      gate={gate}
      wide
      onClose={onClose}
      onDone={(outcome) => {
        if (outcome.status === "done") onOpened(outcome.result.customerId);
      }}
      after={() => (
        <p className="text-sm text-ink-muted">
          Next: open an account for them under Accounts. Their identity stays pending until compliance verifies it.
        </p>
      )}
      build={() => {
        if (name.trim().length < 2) return "Give the customer's full name.";
        if (!isBankDate(birth)) return "Give a date of birth.";
        if (tooYoung) return "A customer must be 18 or older on the bank date.";
        const problem = contactProblem(contact);
        if (problem) return problem;
        return {
          name: "open_customer",
          input: {
            name: name.trim(),
            dateOfBirth: birth,
            email: contact.email.trim(),
            phone: contact.phone.trim(),
            address: contact.address.trim(),
            occupation: contact.occupation.trim(),
            monthlyIncome: parseMoney(contact.income || "0") ?? 0,
          },
        };
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            className={inputClass}
            value={name}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            data-testid="bank-customer-name-input"
          />
        </Field>
        <Field
          label="Date of birth"
          htmlFor={`${id}-birth`}
          error={tooYoung ? "Must be 18 or older on the bank date." : undefined}
          hint="18 or older on the bank date."
        >
          <input
            id={`${id}-birth`}
            type="date"
            max={latestBirth}
            className={cx(inputClass, "font-mono")}
            value={birth}
            aria-invalid={tooYoung || undefined}
            onChange={(event) => setBirth(event.target.value)}
          />
        </Field>
      </div>
      <ContactFields value={contact} onChange={setContact} />
    </WriteDialog>
  );
}

export function EditCustomerDialog({
  customer,
  onClose,
}: {
  customer: CustomerDetail["customer"];
  onClose: () => void;
}) {
  const gate = useGate("customer.manage");
  const before: Contact = {
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    occupation: customer.occupation,
    income: formatMinor(customer.monthlyIncome),
  };
  const [contact, setContact] = useState<Contact>(before);

  return (
    <WriteDialog
      title={`Edit ${customer.name}`}
      submit="Save details"
      pendingLabel="Saving…"
      gate={gate}
      wide
      onClose={onClose}
      build={() => {
        const problem = contactProblem(contact);
        if (problem) return problem;
        const input: Record<string, unknown> = { customerId: customer.id };
        if (contact.email.trim() !== before.email) input.email = contact.email.trim();
        if (contact.phone.trim() !== before.phone) input.phone = contact.phone.trim();
        if (contact.address.trim() !== before.address) input.address = contact.address.trim();
        if (contact.occupation.trim() !== before.occupation) input.occupation = contact.occupation.trim();
        const income = parseMoney(contact.income || "0") ?? 0;
        if (income !== customer.monthlyIncome) input.monthlyIncome = income;
        if (Object.keys(input).length === 1) return "Nothing has changed yet.";
        return { name: "update_customer", input };
      }}
    >
      <p className="text-ink-muted">
        {customer.name}{customer.dateOfBirth ? `, born ${formatDate(customer.dateOfBirth)}` : ""}. A name and date of birth are fixed once the customer
        is open.
      </p>
      <ContactFields value={contact} onChange={setContact} />
    </WriteDialog>
  );
}
