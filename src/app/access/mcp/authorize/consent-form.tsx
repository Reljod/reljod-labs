"use client";

import { type FormEvent, useState } from "react";
import { answerMcpClient } from "@/features/access/components/api";
import { CallbackWarning } from "@/features/access/components/callback-warning";
import {
  quietButtonClass,
  submitClass,
} from "@/features/access/components/styles";
import { useWrite } from "@/features/access/components/use-write";

/**
 * Allow or Deny an MCP client's sign-in to Guest access. Both answers go back
 * to the app that asked, so both buttons are disabled while either runs.
 * When the callback is neither on this machine nor a known client's, the page
 * warns and Allow stays off until the Host ticks "I trust" its host.
 */
export function ConsentForm({
  request,
  clientName,
  callbackHost,
  unknownCallback,
  email,
}: {
  /** The authorization request's query, checked again on the server. */
  request: string;
  clientName: string;
  callbackHost: string;
  /** The callback is neither loopback nor a known client's. */
  unknownCallback: boolean;
  email: string;
}) {
  const { run, pending, outcome } = useWrite<{ to: string }>();
  const [leaving, setLeaving] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const busy = pending || leaving;

  const answer = (choice: "allow" | "deny") => async () => {
    const result = await run(() =>
      answerMcpClient({
        request,
        answer: choice,
        trustHost: trusted ? callbackHost : null,
      }),
    );
    if (!result?.ok) return;
    // Back to the app that asked; the buttons stay off on the way.
    setLeaving(true);
    window.location.assign(result.value.to);
  };

  const allow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unknownCallback && !trusted) return;
    void answer("allow")();
  };

  return (
    <form onSubmit={allow} className="flex flex-col gap-5">
      <h2 className="font-mono text-lg font-bold uppercase">
        {unknownCallback
          ? `Let an app that calls itself "${clientName}" manage guest passes?`
          : `Let ${clientName} manage guest passes?`}
      </h2>
      <p className="text-sm text-ink-muted">
        It will act as you ({email}) on Guest access: list passes, issue new
        ones and see their Guest codes, extend, renew, revoke, delete and
        restore them, and give them new codes. It cannot read what your guests
        saved or use the demos. It stays connected for 30 days, or until you
        disconnect all MCP clients on your profile.
      </p>
      <p className="text-sm text-ink-muted">
        You'll be sent back to{" "}
        <code className="font-mono text-ink">{callbackHost}</code>.
      </p>
      {unknownCallback ? (
        <CallbackWarning
          host={callbackHost}
          clientName={clientName}
          checked={trusted}
          onChange={setTrusted}
          disabled={busy}
          stakes="control of your guest passes"
        />
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy || (unknownCallback && !trusted)}
          aria-busy={busy}
          className={submitClass}
        >
          {busy ? "Connecting…" : "Allow"}
        </button>
        <button
          type="button"
          onClick={answer("deny")}
          disabled={busy}
          className={`${quietButtonClass} min-h-11`}
        >
          Deny
        </button>
      </div>
      {outcome && !outcome.ok ? (
        <p role="alert" className="text-sm text-seal-red">
          {outcome.error}
        </p>
      ) : null}
    </form>
  );
}
