"use client";

import { useActionState } from "react";
import { useSubmitGuard } from "@/components/ui/use-submit-guard";
import { answerMcpClient, type ConsentState } from "../server/oauth-actions";
import { Icon } from "./icons";

/**
 * Allow or Deny an MCP client's sign-in. Both answers go back to the app that
 * asked, so both buttons are disabled while either runs.
 */
export function McpConsent({
  request,
  clientName,
  callbackHost,
  who,
}: {
  /** The authorization request's query, checked again on the server. */
  request: string;
  clientName: string;
  callbackHost: string;
  who: string;
}) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(
    answerMcpClient,
    null,
  );
  const guard = useSubmitGuard(pending, state);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-mono text-xs font-bold tracking-[0.08em] text-federal-blue uppercase">
          <Icon name="plug" className="size-4" /> Connect an MCP client
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Let {clientName} use your client book?
        </h1>
        <p className="text-ink-muted">
          It will read every client's graph, facts and documents, and can add
          facts when you ask it to. It spends against your limits, as {who}.
        </p>
        <p className="text-sm text-ink-muted">
          You'll be sent back to{" "}
          <code className="font-mono text-ink">{callbackHost}</code>.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <form action={action} onSubmit={guard}>
          <input type="hidden" name="request" value={request} />
          <input type="hidden" name="answer" value="allow" />
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="flex items-center gap-2 rounded-sm bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-federal-blue disabled:opacity-50"
          >
            <Icon name="check" className="size-4" />
            {pending ? "Connecting…" : "Allow"}
          </button>
        </form>
        <form action={action} onSubmit={guard}>
          <input type="hidden" name="request" value={request} />
          <input type="hidden" name="answer" value="deny" />
          <button
            type="submit"
            disabled={pending}
            className="rounded-sm border border-ink/20 bg-paper px-4 py-2 text-sm font-medium hover:border-seal-red hover:text-seal-red disabled:opacity-50"
          >
            Deny
          </button>
        </form>
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-seal-red">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
