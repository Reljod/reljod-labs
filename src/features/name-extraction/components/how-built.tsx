"use client";

import { SKILL_IDS, type SkillId } from "../domain/contract";
import { SKILLS } from "../skills";
import { AgentDiagram } from "./agent-diagram";
import type { ToolkitNode } from "./run-view";
import { cx, Panel, Tag } from "./ui";

const WHY = [
  {
    title: "Recall",
    text: "A fixed pipeline reads every document the same way. The Analyst sees what this one needs: a second Reader pass over a dense ledger, a regex over SWIFT fields, a check of every signature block.",
  },
  {
    title: "Cost",
    text: "Readers on a cheap model do the page-by-page reading in parallel; the stronger model only plans, writes code and decides. Code in the Sandbox counts and cross-checks for free.",
  },
  {
    title: "Adapts per document",
    text: "Skills stay out of context until the Analyst loads one, so a 10-page KYC file and a 500-page judgment get different playbooks from the same agent.",
  },
];

/** A Skill as its SKILL.md: frontmatter, then the playbook. */
export function skillMarkdown(id: SkillId) {
  const skill = SKILLS[id];
  return `---\nname: ${id}\ndescription: ${skill.description}\n---\n\n${skill.body.trim()}\n`;
}

/** "How Sieve is built": one Analyst, its toolkit, and why not a pipeline. */
export function HowBuilt({
  live,
  counts,
  running,
  loaded,
}: {
  live: Set<ToolkitNode>;
  counts: Partial<Record<ToolkitNode, number>>;
  running: boolean;
  /** Skills the open Run has loaded. */
  loaded: SkillId[];
}) {
  return (
    <section aria-labelledby="sv-built" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sv-built" className="font-mono text-lg font-bold uppercase">
          How Sieve is built
        </h2>
        <p className="text-sm text-ink-muted">
          {running
            ? "Live: each tool lights up as the Analyst calls it."
            : "Start a run and watch the tools light up."}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel bodyClassName="p-2 sm:p-4">
          <AgentDiagram live={live} counts={counts} running={running} />
        </Panel>
        <div className="flex flex-col gap-3">
          <p className="text-[0.95rem] leading-relaxed">
            <strong>
              One agent with tools, not a fixed multi-agent pipeline.
            </strong>{" "}
            The Analyst decides what to do next. Readers are a tool it calls,
            not stages it hands off to. A deterministic Sweep sets a recall
            floor, and the harness&apos;s Done gate refuses{" "}
            <code className="font-mono text-sm">finish</code> until every page
            is read and every candidate is recorded or dismissed.
          </p>
          <ul className="flex flex-col gap-2">
            {WHY.map((item) => (
              <li
                key={item.title}
                className="rounded-sm border border-ink/15 bg-paper px-3 py-2 text-sm"
              >
                <span className="font-semibold">{item.title}.</span> {item.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <details className="group rounded-sm border border-ink/15 bg-paper">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold">
          <span aria-hidden="true" className="font-mono group-open:rotate-90">
            ▸
          </span>
          Skills the Analyst can load ({SKILL_IDS.length})
          <span className="font-normal text-ink-muted">
            Only the description is in context until it loads one.
          </span>
        </summary>
        <ul className="grid gap-3 border-ink/10 border-t p-4 md:grid-cols-2">
          {SKILL_IDS.map((id) => (
            <li key={id} className="min-w-0">
              <details
                className={cx(
                  "rounded-sm border bg-marble/40",
                  loaded.includes(id) ? "border-federal-blue" : "border-ink/15",
                )}
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-mono text-xs text-ink-muted">
                    {id}/SKILL.md
                  </span>
                  {loaded.includes(id) ? <Tag tone="blue">loaded</Tag> : null}
                  <span className="w-full text-sm">
                    <span className="font-semibold">{SKILLS[id].title}</span>{" "}
                    <span className="text-ink-muted">
                      {SKILLS[id].description}
                    </span>
                  </span>
                </summary>
                <pre className="sv-scroll max-h-80 overflow-auto border-ink/10 border-t bg-paper p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {skillMarkdown(id)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
