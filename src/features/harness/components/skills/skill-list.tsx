"use client";

import { useMemo, useState } from "react";
import type { SkillView } from "../../domain/skills";
import { cx, Empty, inputClass } from "../ui";

export type SkillGroups = {
  pipelines: { skill: SkillView; rulebook: SkillView | null }[];
  general: SkillView[];
};

/** "Pipelines": each Pipeline's Skill with its Rulebook nested under it; "General": the rest. Search matches name and description. */
export function groupSkills(
  skills: readonly SkillView[],
  search: string,
): SkillGroups {
  const needle = search.trim().toLowerCase();
  const matches = (skill: SkillView) =>
    !needle ||
    skill.id.toLowerCase().includes(needle) ||
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle);
  const rulebooks = skills.filter((skill) => skill.kind === "rulebook");
  const pipelines = skills
    .filter((skill) => skill.kind === "skill" && skill.pipelineId)
    .map((skill) => ({
      skill,
      rulebook:
        rulebooks.find((book) => book.pipelineId === skill.pipelineId) ?? null,
    }))
    .filter(
      ({ skill, rulebook }) =>
        matches(skill) || (rulebook ? matches(rulebook) : false),
    );
  // A Rulebook whose Pipeline Skill is not in the list still shows.
  const orphans = rulebooks
    .filter(
      (book) =>
        !skills.some(
          (skill) =>
            skill.kind === "skill" && skill.pipelineId === book.pipelineId,
        ),
    )
    .filter(matches)
    .map((rulebook) => ({ skill: rulebook, rulebook: null }));
  return {
    pipelines: [...pipelines, ...orphans],
    general: skills
      .filter((skill) => skill.kind === "skill" && !skill.pipelineId)
      .filter(matches),
  };
}

function Item({
  skill,
  selected,
  nested = false,
  onSelect,
}: {
  skill: SkillView;
  selected: boolean;
  nested?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(skill.id)}
      className={cx(
        "flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue",
        nested && "pl-7",
        selected
          ? "border-federal-blue bg-morning-haze"
          : "border-transparent hover:bg-marble",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs font-semibold">
            {skill.id}
          </span>
          {skill.kind === "rulebook" ? (
            <span className="shrink-0 rounded-sm border border-ink/20 px-1 font-mono text-[0.55rem] text-ink-muted uppercase">
              rules
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
          {skill.description}
        </span>
      </span>
      {skill.edited ? (
        <span
          role="img"
          aria-label="Edited from the Default"
          title="Edited from the Default"
          className="mt-1.5 size-2 shrink-0 rounded-full bg-brass"
        />
      ) : null}
    </button>
  );
}

export function SkillList({
  skills,
  selectedId,
  onSelect,
}: {
  skills: readonly SkillView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const groups = useMemo(() => groupSkills(skills, search), [skills, search]);
  const none = groups.pipelines.length === 0 && groups.general.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-ink/10 border-b p-2">
        <input
          type="search"
          aria-label="Search Skills"
          placeholder="Search Skills"
          className={inputClass}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="hx-scroll min-h-0 flex-1 pb-2">
        {none ? (
          <Empty title="No Skill matches">
            Try a word from its description.
          </Empty>
        ) : null}
        {groups.pipelines.length > 0 ? (
          <section aria-label="Pipelines">
            <h3 className="eyebrow px-3 pt-3 pb-1 text-[0.65rem] text-ink-muted">
              Pipelines
            </h3>
            {groups.pipelines.map(({ skill, rulebook }) => (
              <div key={skill.id}>
                <Item
                  skill={skill}
                  selected={skill.id === selectedId}
                  onSelect={onSelect}
                />
                {rulebook ? (
                  <Item
                    nested
                    skill={rulebook}
                    selected={rulebook.id === selectedId}
                    onSelect={onSelect}
                  />
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        {groups.general.length > 0 ? (
          <section aria-label="General">
            <h3 className="eyebrow px-3 pt-3 pb-1 text-[0.65rem] text-ink-muted">
              General
            </h3>
            {groups.general.map((skill) => (
              <Item
                key={skill.id}
                skill={skill}
                selected={skill.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
