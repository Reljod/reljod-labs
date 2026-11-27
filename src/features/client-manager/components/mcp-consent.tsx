"use client";

import { useActionState, useState } from "react";
import { useSubmitGuard } from "@/components/ui/use-submit-guard";
import { CallbackWarning } from "@/features/access/components/callback-warning";
import { answerMcpClient, type ConsentState } from "../server/oauth-actions";
import { Icon } from "./icons";

/**
 * Allow or Deny an MCP client's sign-in. Both answers go back to the app that
 * asked, so both buttons are disabled while either runs. When the callback is
 * neither on this machine nor a known client's, the page warns and Allow
 * stays off until the person ticks "I trust" the callback's host.
 */
export function McpConsent({
  request,
  clientName,
  callbackHost,
  unknownCallback,
  who,
}: {
  /** The authorization request's query, checked again on the server. */
  request: string;
  clientName: string;
  callbackHost: string;
  /** The callback is neither loopback nor a known client's. */
  unknownCallback: boolean;
  who: string;
}) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(
    answerMcpClient,
    null,
  );
  const [trusted, setTrusted] = useState(false);
  const guard = useSubmitGuard(pending, state);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-mono text-xs font-bold tracking-[0.08em] text-federal-blue uppercase">
          <Icon name="plug" className="size-4" /> Connect an MCP client
        </p>
        <h1 className="font-mono text-2xl leading-tight font-bold uppercase">
          {unknownCallback
            ? `Let an app that calls itself "${clientName}" use your client book?`
            : `Let ${clientName} use your client book?`}
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
      <form
        id="mcp-consent-allow"
        action={action}
        onSubmit={guard}
        className="space-y-6"
      >
        {unknownCallback ? (
          <CallbackWarning
            host={callbackHost}
            clientName={clientName}
            checked={trusted}
            onChange={setTrusted}
            disabled={pending}
          />
        ) : null}
        <input type="hidden" name="request" value={request} />
        <input type="hidden" name="answer" value="allow" />
      </form>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          form="mcp-consent-allow"
          disabled={pending || (unknownCallback && !trusted)}
          aria-busy={pending}
          className="outline-box press eyebrow flex items-center gap-2 rounded-sm bg-federal-blue px-4 py-2 font-bold text-paper disabled:opacity-50"
        >
          <Icon name="check" className="size-4" />
          {pending ? "Connecting…" : "Allow"}
        </button>
        <form action={action} onSubmit={guard}>
          <input type="hidden" name="request" value={request} />
          <input type="hidden" name="answer" value="deny" />
          <button
            type="submit"
            disabled={pending}
            className="outline-box press eyebrow rounded-sm bg-paper px-4 py-2 font-bold hover:text-seal-red disabled:opacity-50"
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
