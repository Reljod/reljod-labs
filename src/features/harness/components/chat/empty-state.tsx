"use client";

import { SAMPLES } from "../../domain/samples";
import { cx } from "../ui";
import { SUGGESTED_PROMPTS, type SuggestedPrompt } from "./prompts";

/** Who the Agent is and what to try, shown in a Session with no messages. */
export function ChatEmptyState({
  staffName,
  busy,
  onPrompt,
}: {
  staffName: string;
  busy: boolean;
  onPrompt: (prompt: SuggestedPrompt) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-5 sm:py-10">
      <h2 className="font-mono text-xl leading-tight font-bold uppercase">
        Good to see you, {staffName.split(" ")[0]}.
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        I am the Agent on the Pensions Operations Desk at Harbour Bank &amp;
        Trust. I read the desk's Skills, search its Knowledge base and call
        tools on the Harness MCP server. I can run the three Pipelines (member
        requests, contribution Schedules and the delinquency report), and show
        you every Step. When a question needs counting, totalling or checking a
        file, I write and run code in a Sandbox with no network. I never give an
        Approval and I never decide a case: a person does. Everything here is
        fictional and marked SPECIMEN.
      </p>
      <p className="mt-5 font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
        Try one
      </p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {SUGGESTED_PROMPTS.map((prompt) => {
          const sample = prompt.sampleGroup
            ? SAMPLES.find((item) => item.group === prompt.sampleGroup)
            : undefined;
          return (
            <li key={prompt.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPrompt(prompt)}
                className={cx(
                  "outline-box press h-full w-full rounded-sm bg-paper px-3 py-2.5 text-left hover:bg-morning-haze",
                  "disabled:translate-none disabled:cursor-not-allowed disabled:bg-marble disabled:opacity-60 disabled:shadow-none",
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
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
