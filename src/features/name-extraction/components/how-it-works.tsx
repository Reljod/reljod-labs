"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { SKILL_IDS, type SkillId } from "../domain/contract";
import { SKILLS } from "../skills";
import { READER_COLORS } from "./page-map";
import { PLAYBOOK } from "./plain";
import { cx } from "./ui";

/** A Skill as its SKILL.md: frontmatter, then the playbook. */
export function skillMarkdown(id: SkillId) {
  const skill = SKILLS[id];
  return `---\nname: ${id}\ndescription: ${skill.description}\n---\n\n${skill.body.trim()}\n`;
}

function Flow({ vertical = false }: { vertical?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={vertical ? "h-8 w-3" : "h-3 w-full min-w-6"}
      viewBox={vertical ? "0 0 4 32" : "0 0 40 4"}
      preserveAspectRatio="none"
    >
      <line
        x1={vertical ? 2 : 0}
        y1={vertical ? 0 : 2}
        x2={vertical ? 2 : 40}
        y2={vertical ? 32 : 2}
        stroke="var(--color-federal-blue)"
        strokeWidth="2"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
        className="sv-flow"
      />
    </svg>
  );
}

function Part({
  title,
  line,
  art,
}: {
  title: string;
  line: string;
  art: ReactNode;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="flex min-w-0 flex-col gap-2 rounded-sm border-2 border-ink bg-paper p-3 shadow-hard-sm"
    >
      <div className="flex h-12 items-center">{art}</div>
      <p className="font-mono text-xs font-bold uppercase">{title}</p>
      <p className="text-xs leading-snug text-ink-muted">{line}</p>
    </motion.li>
  );
}

/**
 * "How it works" in one picture: a lead agent, the reader agents it sends
 * out, the playbooks it loads, the sandbox it checks in, and the final check
 * it must pass. Two sentences, no more.
 */
export function HowItWorks({ loaded }: { loaded: SkillId[] }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-[1.02rem] leading-relaxed">
        One lead agent plans the work and sends cheap reader agents through the
        pages in parallel. It loads playbooks when it needs them, checks its
        work with code, and may only finish once every page is read.
      </p>

      <div className="flex flex-col items-center gap-0">
        <div className="grid w-full max-w-2xl grid-cols-[auto_minmax(1.5rem,1fr)_auto_minmax(1.5rem,1fr)_auto] items-center">
          <span className="rounded-sm border-2 border-ink bg-paper px-2.5 py-2 font-mono text-[0.68rem] font-bold uppercase">
            Document
          </span>
          <Flow />
          <span className="rounded-sm border-2 border-ink bg-ink px-3 py-2.5 text-center font-mono text-xs font-bold text-paper uppercase shadow-hard-sm">
            Lead agent
          </span>
          <Flow />
          <span className="rounded-sm border-2 border-ink bg-brass px-2.5 py-2 font-mono text-[0.68rem] font-bold uppercase">
            Names
          </span>
        </div>
        <Flow vertical />
        <ul className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
          <Part
            title="Reader agents"
            line="Each reads one stretch of pages, all at once."
            art={
              <span className="flex gap-1">
                {READER_COLORS.slice(0, 5).map((color, index) => (
                  <span
                    key={color}
                    className="sv-blink h-9 w-6 rounded-[2px] border border-ink/30"
                    style={{
                      background: color,
                      animationDelay: `${index * 0.3}s`,
                    }}
                  />
                ))}
              </span>
            }
          />
          <Part
            title="Playbooks"
            line="Know-how loaded only when the file calls for it."
            art={
              <span className="relative h-10 w-14">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="absolute h-8 w-10 rounded-[2px] border-2 border-ink bg-paper"
                    style={{ left: index * 6, top: 6 - index * 3 }}
                  />
                ))}
              </span>
            }
          />
          <Part
            title="Sandbox"
            line="Writes small programs to count and cross-check."
            art={
              <span className="rounded-sm bg-ink px-2 py-1.5 font-mono text-sm text-clear-sky">
                {"{ }"}
                <span className="ml-0.5 motion-safe:animate-pulse">▍</span>
              </span>
            }
          />
          <Part
            title="Final check"
            line="Refuses to finish while a page or lead is left."
            art={
              <span className="flex size-10 items-center justify-center rounded-sm border-2 border-ivy bg-ivy/10 font-mono text-lg font-bold text-ivy">
                ✓
              </span>
            }
          />
        </ul>
      </div>

      <details className="group outline-box rounded-sm bg-paper">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold">
          <span aria-hidden="true" className="font-mono group-open:rotate-90">
            ▸
          </span>
          The playbooks it can load ({SKILL_IDS.length})
        </summary>
        <ul className="grid gap-2 border-ink/10 border-t p-3 md:grid-cols-2">
          {SKILL_IDS.map((id) => (
            <li key={id} className="min-w-0">
              <details
                className={cx(
                  "rounded-sm border bg-marble/40",
                  loaded.includes(id) ? "border-federal-blue" : "border-ink/15",
                )}
              >
                <summary className="flex cursor-pointer list-none flex-col gap-0.5 px-3 py-2">
                  <span className="text-sm font-semibold first-letter:uppercase">
                    {PLAYBOOK[id]}
                    {loaded.includes(id) ? (
                      <span className="ml-2 font-mono text-[0.65rem] text-federal-blue">
                        used in this run
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {SKILLS[id].description}
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
    </div>
  );
}
