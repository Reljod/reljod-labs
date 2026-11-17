"use client";

import { useActionState, useId } from "react";
import { useSubmitGuard } from "@/components/ui/use-submit-guard";
import {
  Button,
  ErrorNote,
  Field,
  inputClass,
} from "@/features/harness/components/ui";
import { ROLE_LABEL, type Staff } from "@/features/harness/domain/staff";
import {
  answerHarnessClient,
  type ConsentState,
} from "@/features/harness/server/oauth-actions";

/**
 * Allow or Deny an MCP client's sign-in to the Harness, choosing which Staff
 * member it acts as. Both answers go back to the app that asked, so both
 * buttons are disabled while either runs.
 */
export function ConsentForm({
  request,
  clientName,
  callbackHost,
  who,
  staff,
  current,
}: {
  /** The authorization request's query, checked again on the server. */
  request: string;
  clientName: string;
  callbackHost: string;
  who: string;
  staff: Staff[];
  current: string;
}) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(
    answerHarnessClient,
    null,
  );
  const guard = useSubmitGuard(pending, state);
  const pick = useId();
  return (
    <form action={action} onSubmit={guard} className="space-y-6">
      <div className="space-y-2">
        <p className="eyebrow text-[0.65rem] text-federal-blue">
          Connect Claude to the Harness
        </p>
        <h1 className="font-mono text-2xl leading-tight font-bold uppercase">
          Let {clientName} work at the desk?
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
      <input type="hidden" name="request" value={request} />
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
          pendingLabel="Connecting…"
        >
          Allow
        </Button>
        <Button type="submit" name="answer" value="deny" disabled={pending}>
          Deny
        </Button>
      </div>
      <ErrorNote>{state?.error}</ErrorNote>
    </form>
  );
}
