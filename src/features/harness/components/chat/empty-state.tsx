"use client";

import { SAMPLES } from "../../domain/samples";
import { cx } from "../ui";
import { SUGGESTED_PROMPTS, type SuggestedPrompt } from "./prompts";

/** Who the Agent is and what to try, shown in a Session with no messages. */
export function ChatEmptyState({
  isAdmin,
  staffName,
  busy,
  onPrompt,
}: {
  isAdmin: boolean;
  staffName: string;
  busy: boolean;
  onPrompt: (prompt: SuggestedPrompt) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-5 sm:py-10">
      <h2 className="text-lg font-semibold">
        Good to see you, {staffName.split(" ")[0]}.
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        I am the Agent on the Pensions Operations Desk at Harbour Bank &amp;
        Trust. I read the desk's Skills, search its Knowledge base and call
        tools on the Harness MCP server. I can run the three Pipelines (member
        requests, contribution Schedules and the delinquency report), and show
        you every Step. I never give an Approval and I never decide a case: a
        person does. Everything here is fictional and marked SPECIMEN.
      </p>
      <p className="mt-5 font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
        Try one
      </p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {SUGGESTED_PROMPTS.map((prompt) => {
          const locked = prompt.admin === true && !isAdmin;
          const sample = prompt.sampleGroup
            ? SAMPLES.find((item) => item.group === prompt.sampleGroup)
            : undefined;
          const reasonId = `prompt-${prompt.id}-reason`;
          return (
            <li key={prompt.id}>
              <button
                type="button"
                disabled={locked || busy}
                aria-describedby={locked ? reasonId : undefined}
                onClick={() => onPrompt(prompt)}
                className={cx(
                  "h-full w-full rounded-sm border border-ink/20 bg-paper px-3 py-2.5 text-left transition-colors",
                  "hover:border-ink/50 hover:bg-marble focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
                  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-ink/20 disabled:hover:bg-paper",
                )}
              >
                <span className="block text-sm font-semibold">
                  {prompt.title}
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {prompt.hint}
                </span>
                {sample ? (
                  <span className="mt-1 block text-xs text-federal-blue">
                    Attaches {sample.title}
                  </span>
                ) : null}
                {locked ? (
                  <span id={reasonId} className="mt-1 block text-xs text-oak">
                    Only an admin may use the Sandbox. Switch Staff to the
                    Operations Manager to try it.
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
