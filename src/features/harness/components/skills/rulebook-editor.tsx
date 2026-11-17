"use client";

import { useMemo, useState } from "react";
import { pipelineOf } from "../../domain/pipelines";
import type { RuleView } from "../../domain/rules";
import { renderSkillMd, type SkillView } from "../../domain/skills";
import { groupRulesByStep, ruleSummary } from "../../domain/skills/group";
import { scrollWithin } from "../scroll";
import { Button, cx, Empty } from "../ui";
import { RuleCard, type RuleCardHandle } from "./rule-card";
import { scheduledCount } from "./schedule";

/**
 * A Rulebook edited as Rule cards (ADR 0015), grouped by Pipeline Step in
 * the Pipeline's order, with a sticky Step index. "Read as SKILL.md" shows
 * the text the Agent and Claude read: rendered from these same Rules.
 */
export function RulebookEditor({
  skill,
  rules,
  canEdit,
  readOnlyReason,
  openRuleId,
  register,
  onBack,
}: {
  skill: SkillView;
  rules: RuleView[];
  canEdit: boolean;
  readOnlyReason: string;
  openRuleId: string | null;
  register: (ruleId: string, handle: RuleCardHandle | null) => void;
  onBack: () => void;
}) {
  const pipeline = skill.pipelineId ? pipelineOf(skill.pipelineId) : null;
  const mine = useMemo(
    () => rules.filter((rule) => rule.spec.pipelineId === skill.pipelineId),
    [rules, skill.pipelineId],
  );
  const groups = useMemo(
    () => groupRulesByStep(pipeline, mine),
    [pipeline, mine],
  );
  const summary = ruleSummary(mine);
  const scheduled = scheduledCount(mine);
  const [asText, setAsText] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 space-y-2 border-ink/10 border-b px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="lg:hidden"
            onClick={onBack}
          >
            ← Skills
          </Button>
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-[0.65rem] text-ink-muted">Rulebook</p>
            <h2 className="truncate font-mono text-sm font-bold">
              {pipeline?.title ?? skill.name}
            </h2>
          </div>
          <Button
            size="sm"
            aria-pressed={asText}
            onClick={() => setAsText((value) => !value)}
          >
            {asText ? "Back to cards" : "Read as SKILL.md"}
          </Button>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-ink-muted">
          <span>{summary.total} Rules</span>
          <span className={summary.edited > 0 ? "text-oak" : undefined}>
            {summary.edited} edited
          </span>
          {scheduled > 0 ? (
            <span
              className="text-brass"
              title="Runs use the Version in force today, not the latest"
            >
              {scheduled} scheduled
            </span>
          ) : null}
          <span className={summary.off > 0 ? "text-seal-red" : undefined}>
            {summary.off} off
          </span>
        </p>
        {!canEdit ? (
          <p className="rounded-sm border border-ink/15 bg-marble/60 px-3 py-1.5 text-xs text-ink-muted">
            {readOnlyReason}
          </p>
        ) : null}
        {!asText && groups.length > 1 ? (
          <nav
            aria-label="Steps"
            className="hx-scroll-x -mb-1 flex gap-1.5 pb-1"
          >
            {groups.map((group) => (
              <button
                key={group.stepId}
                type="button"
                onClick={() =>
                  scrollWithin(
                    document.getElementById(`step-${skill.id}-${group.stepId}`),
                  )
                }
                className="shrink-0 rounded-sm border border-ink/20 bg-paper px-2 py-1 text-xs font-medium text-ink-muted hover:border-ink/40 hover:text-ink"
              >
                {group.title}
                <span className="ml-1 font-mono text-[0.65rem]">
                  {group.rules.length}
                </span>
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="hx-scroll min-h-0 flex-1 px-3 pt-0 pb-3 sm:px-4">
        {asText ? (
          <div className="space-y-2 pt-3">
            <p className="text-xs text-ink-muted">
              This is what the Agent and Claude read. It is built from the Rules
              on the cards: change a card and this text changes.
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-sm border border-ink/15 bg-marble/40 p-3 font-mono text-xs leading-5 [overflow-wrap:anywhere]">
              {renderSkillMd(skill)}
            </pre>
          </div>
        ) : groups.length === 0 ? (
          <div className="pt-3">
            <Empty title="No Rules yet">
              This Pipeline has no Rules to edit.
            </Empty>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section
                key={group.stepId}
                id={`step-${skill.id}-${group.stepId}`}
                aria-label={group.title}
                className="space-y-2"
              >
                <h3 className="eyebrow sticky top-0 z-10 -mx-3 border-ink/10 border-b bg-paper px-3 py-2 text-[0.7rem] text-ink-muted sm:-mx-4 sm:px-4">
                  {group.title}
                </h3>
                <div className={cx("space-y-3")}>
                  {group.rules.map((rule) => (
                    <RuleCard
                      key={rule.spec.id}
                      view={rule}
                      canEdit={canEdit}
                      highlighted={openRuleId === rule.spec.id}
                      register={register}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
