"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ruleSpec } from "../../domain/rules";
import { getRules } from "../../server/rule-actions";
import { RULES_KEY, RuleCard } from "./rule-card";

const STAGES = [
  {
    id: "verify",
    title: "Verify",
    summary: "Shapes every check: which readings code may decide on.",
  },
  {
    id: "evaluate",
    title: "Evaluate",
    summary:
      "One Rule per Requirement. Each is decided by a pure function over the readings; the model never returns a Finding.",
  },
] as const;

/**
 * The Owner's Rulebook: every Rule as a card, grouped by the stage whose code
 * uses it. A new Pre-screen applies the Rules as they are when it starts;
 * a finished run can be re-evaluated against them without calling the model.
 */
export function RulebookEditor() {
  const rules = useQuery({ queryKey: RULES_KEY, queryFn: () => getRules() });

  if (rules.isPending) {
    return (
      <div className="flex animate-pulse flex-col gap-3" aria-busy>
        <div className="h-28 rounded-sm bg-limestone" />
        <div className="h-28 rounded-sm bg-limestone" />
        <div className="h-28 rounded-sm bg-limestone" />
      </div>
    );
  }
  if (rules.isError) {
    return (
      <p role="alert" className="outline-box rounded-sm bg-limestone px-4 py-3">
        ✕ Could not load the Rules. Try again in a moment.
      </p>
    );
  }

  const edited = rules.data.filter((rule) => rule.edited).length;
  return (
    <div className="flex flex-col gap-8" data-testid="rulebook">
      <section className="outline-box flex flex-col gap-2 rounded-sm bg-morning-haze p-4 text-sm">
        <p>
          <strong>Individual onboarding, Meridia.</strong> Rules are data; the
          checks that apply them are code. Saving a Rule makes its next Version,
          and every Pre-screen records the Versions it applied, so an old
          Finding can still be explained after a Rule changes.
        </p>
        <p className="font-mono text-xs">
          {edited === 0
            ? "Every Rule is at its Default."
            : `${edited} Rule${edited === 1 ? "" : "s"} differ${edited === 1 ? "s" : ""} from the Default.`}{" "}
          New runs use these Rules; on a finished run, choose{" "}
          <em>Re-evaluate</em> to apply them for free.{" "}
          <Link
            href="/demos/document-compliance"
            className="text-federal-blue underline"
          >
            Run a pack →
          </Link>
        </p>
      </section>

      {STAGES.map((stage) => {
        const inStage = rules.data.filter(
          (rule) => ruleSpec(rule.id).stage === stage.id,
        );
        return (
          <section
            key={stage.id}
            aria-labelledby={`stage-${stage.id}`}
            className="flex flex-col gap-3"
          >
            <header className="flex flex-wrap items-baseline gap-x-3">
              <h2
                id={`stage-${stage.id}`}
                className="font-mono text-lg font-bold uppercase"
              >
                {stage.title}
              </h2>
              <span className="text-sm text-ink-muted">{stage.summary}</span>
            </header>
            {inStage.map((rule) => (
              <RuleCard key={rule.id} rule={rule} />
            ))}
          </section>
        );
      })}

      <p className="text-xs text-ink-muted">
        Meridia and its law are fictional. Citations point at the shape of a
        real customer due diligence regime, not at any real statute; this is a
        demo, not legal advice.
      </p>
    </div>
  );
}
