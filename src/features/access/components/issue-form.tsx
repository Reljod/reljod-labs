"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IssuedPass } from "../domain/api";
import { durationLabel, LIMITS } from "../domain/guest-pass";
import { issueGuestPass } from "./api";
import { LocalTime } from "./local-time";
import { fieldClass, quietButtonClass, submitClass } from "./styles";
import { useWrite } from "./use-write";

/** Where a Host issues a Guest pass and reads off its Guest code. */
export function IssueForm() {
  const router = useRouter();
  const { run, pending, outcome } = useWrite<IssuedPass>();
  const [copied, setCopied] = useState(false);
  const issued = outcome?.ok ? outcome.value : null;

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          const result = await run(() => {
            setCopied(false);
            return issueGuestPass({
              label: String(form.get("label") ?? ""),
              hours: Number(form.get("hours")),
              devices: Number(form.get("devices")),
            });
          });
          if (result?.ok) {
            element.reset();
            // The list below gains the new pass.
            router.refresh();
          }
        }}
        className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr] sm:items-end"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="pass-label" className="eyebrow">
            Who is it for
          </label>
          <input
            id="pass-label"
            name="label"
            required
            maxLength={LIMITS.labelLength}
            placeholder="Ana at Meridia Bank"
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="pass-hours" className="eyebrow">
            Lasts
          </label>
          <select
            id="pass-hours"
            name="hours"
            defaultValue={LIMITS.defaultDurationHours}
            className={fieldClass}
          >
            {LIMITS.durationsHours.map((hours) => (
              <option key={hours} value={hours}>
                {durationLabel(hours)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="pass-devices" className="eyebrow">
            Devices
          </label>
          <select
            id="pass-devices"
            name="devices"
            defaultValue={LIMITS.defaultDevices}
            className={fieldClass}
          >
            {Array.from({ length: LIMITS.maxDevices }, (_, i) => i + 1).map(
              (devices) => (
                <option key={devices} value={devices}>
                  {devices}
                </option>
              ),
            )}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={`${submitClass} sm:col-span-3`}
        >
          {pending ? "Issuing…" : "Issue guest pass"}
        </button>
      </form>

      {outcome && !outcome.ok ? (
        <p role="alert" className="text-sm text-seal-red">
          {outcome.error}
        </p>
      ) : null}

      {issued ? (
        <div
          aria-live="polite"
          data-testid="issued-code"
          className="outline-box bg-morning-haze p-5 shadow-hard-md"
        >
          <p className="eyebrow">Guest code for {issued.label}</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <p className="font-mono text-2xl font-bold tracking-[0.15em] sm:text-3xl">
              {issued.code}
            </p>
            <button
              type="button"
              className={quietButtonClass}
              onClick={async () => {
                await navigator.clipboard.writeText(issued.code);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-sm">
            Copy it now: it is shown once and cannot be looked up again. Works
            on {issued.devices} device{issued.devices === 1 ? "" : "s"} until{" "}
            <LocalTime iso={issued.expiresAt} />.
          </p>
        </div>
      ) : null}
    </div>
  );
}
