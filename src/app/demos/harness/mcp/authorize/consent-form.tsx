"use client";

import { type FormEvent, useId, useState } from "react";
import { CallbackWarning } from "@/features/access/components/callback-warning";
import { api } from "@/features/harness/components/api";
import {
  Button,
  ErrorNote,
  Field,
  inputClass,
} from "@/features/harness/components/ui";
import { ROLE_LABEL, type Staff } from "@/features/harness/domain/staff";

/**
 * Allow or Deny an MCP client's sign-in to the Harness, choosing which Staff
 * member it acts as. Both answers go back to the app that asked, so both
 * buttons are disabled while either runs. When the callback is neither on
 * this machine nor a known client's, the page warns and Allow stays off
 * until the person ticks "I trust" the callback's host.
 */
export function ConsentForm({
  request,
  clientName,
  callbackHost,
  unknownCallback,
  who,
  staff,
  current,
}: {
  /** The authorization request's query, checked again on the server. */
  request: string;
  clientName: string;
  callbackHost: string;
  /** The callback is neither loopback nor a known client's. */
  unknownCallback: boolean;
  who: string;
  staff: Staff[];
  current: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trusted, setTrusted] = useState(false);
  const pick = useId();

  /** Both answers go back to the app that asked: the route says where, the browser goes. */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const outcome = await api.mcp.consent({
      request,
      answer:
        submitter instanceof HTMLButtonElement && submitter.value === "allow"
          ? "allow"
          : "deny",
      staffId: String(form.get("staffId") ?? ""),
      trustHost: form.get("trustHost") ? String(form.get("trustHost")) : null,
    });
    if (outcome.ok) {
      // Stays pending: the page is leaving.
      window.location.assign(outcome.value.redirect);
      return;
    }
    setError(outcome.error);
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <p className="eyebrow text-[0.65rem] text-federal-blue">
          Connect Claude to the Harness
        </p>
        <h1 className="font-mono text-2xl leading-tight font-bold uppercase">
          {unknownCallback
            ? `Let an app that calls itself "${clientName}" work at the desk?`
            : `Let ${clientName} work at the desk?`}
        </h1>
        <p className="text-sm text-ink-muted">
          It will use the Harness's tools as the Staff member you choose: start
          Pipelines, read records, search and add to the Knowledge base, and
          read Skills and the Audit trail, as far as their Role allows. It can
          never give an Approval. It spends against your limits, as {who}.
        </p>
        <p className="text-sm text-ink-muted">
          You'll be sent back to{" "}
          <code className="font-mono text-ink">{callbackHost}</code>.
        </p>
      </div>
      {unknownCallback ? (
        <CallbackWarning
          host={callbackHost}
          clientName={clientName}
          checked={trusted}
          onChange={setTrusted}
          disabled={pending}
        />
      ) : null}
      <Field
        label="Act as"
        htmlFor={pick}
        hint="Fixed for this connection. Changing Staff in the app later does not change it."
      >
        <select
          id={pick}
          name="staffId"
          defaultValue={current}
          disabled={pending}
          className={inputClass}
        >
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}, {member.title} ({ROLE_LABEL[member.role]})
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          name="answer"
          value="allow"
          variant="primary"
          pending={pending}
          disabled={unknownCallback && !trusted}
          pendingLabel="Connecting…"
        >
          Allow
        </Button>
        <Button type="submit" name="answer" value="deny" disabled={pending}>
          Deny
        </Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}
