"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/features/harness/components/ui";
import type { AskAnswer, Source } from "../domain/api";
import { LIMITS } from "../domain/limits";
import { askFootage } from "./api";
import { clock, money } from "./look";

/**
 * Ask the footage anything; the answer comes with moments to jump to. The
 * Sample suggestions are questions a manager would ask, not test prompts.
 */
export function AskFootage({
  source,
  suggestions,
  onAnswer,
  onSeek,
  disabled,
}: {
  source: Source;
  suggestions: string[];
  onAnswer: (answer: AskAnswer | null) => void;
  onSeek: (t: number) => void;
  disabled: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (q.length < 3 || pending) return;
    setQuestion(q);
    setPending(true);
    setError(null);
    try {
      const reply = await askFootage(source, q);
      setAnswer(reply);
      onAnswer(reply);
      if (reply.moments[0]) onSeek(Math.max(0, reply.moments[0].at - 0.5));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The question could not be asked.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div data-testid="floorwalk-ask">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={LIMITS.questionChars}
          placeholder="Ask the footage: which doors were left open?"
          aria-label="Ask the footage"
          className="min-w-0 flex-1 rounded-sm border-2 border-ink bg-paper px-3 py-2 text-sm"
          disabled={disabled}
        />
        <Button
          type="submit"
          variant="primary"
          pending={pending}
          pendingLabel="Watching…"
          disabled={disabled || question.trim().length < 3}
        >
          Ask
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled || pending}
            onClick={() => void send(s)}
            className="press rounded-sm border-2 border-ink bg-marble px-2 py-1 text-[12px] disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-sm text-seal-red" role="alert">
          {error}
        </p>
      ) : null}
      {answer ? (
        <motion.div
          key={answer.answer}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 rounded-sm border-2 border-ink bg-morning-haze/50 p-3"
        >
          <p className="text-sm leading-snug">{answer.answer}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {answer.moments.map((m) => (
              <button
                key={`${m.at}-${m.label}`}
                type="button"
                onClick={() => onSeek(Math.max(0, m.at - 0.5))}
                className="press rounded-sm border-2 border-ink bg-ivy px-2 py-0.5 font-mono text-[11px] font-bold text-paper"
              >
                ▶ {clock(m.at)} {m.label}
              </button>
            ))}
          </div>
          <p className="mt-2 font-mono text-[10px] text-ink-muted">
            {(answer.ms / 1000).toFixed(1)} s · {money(answer.usage.costUsd)}
          </p>
        </motion.div>
      ) : null}
    </div>
  );
}
