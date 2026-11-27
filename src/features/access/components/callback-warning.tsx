"use client";

import { useId } from "react";

/**
 * The consent pages' warning for a callback that is neither on this machine
 * nor a known client's: anyone can register an MCP client with any https
 * callback and any name, so the page says so plainly and Allow stays off
 * until the person ticks "I trust <host>". The box's value is the host, and
 * the consent action checks it again (`callbackVouched`).
 */
export function CallbackWarning({
  host,
  clientName,
  checked,
  onChange,
  disabled,
}: {
  host: string;
  clientName: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const box = useId();
  return (
    <div
      role="alert"
      className="outline-box space-y-3 rounded-sm border-seal-red bg-paper p-4 shadow-hard-sm"
    >
      <p className="eyebrow text-seal-red">
        Unknown app: check before you allow
      </p>
      <p className="text-sm">
        <code className="font-mono font-bold">{host}</code> is not a client this
        site knows. The name "{clientName}" is only what the app calls itself:
        anyone can register any name and any address. If you did not just start
        this from an app you trust at that address, choose Deny. Allowing it
        hands it your demo data for up to 30 days.
      </p>
      <label htmlFor={box} className="flex items-start gap-2 text-sm font-bold">
        <input
          id={box}
          type="checkbox"
          name="trustHost"
          value={host}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 accent-seal-red"
        />
        <span>
          I trust <code className="font-mono">{host}</code>
        </span>
      </label>
    </div>
  );
}
