import { baseBooks } from "../legacy/base-books";
import type { Fixture } from "../legacy/types";
import type { TaskCard } from "./contract";
import { parseManifest } from "./manifest";
import { SAMPLE_TASKS } from "./tasks";

/** The sample Tasks as the page shows them: no Script, no Fixture. */
export function taskCards(): TaskCard[] {
  return SAMPLE_TASKS.map((task) => ({
    id: task.id,
    title: task.title,
    summary: task.summary,
    brief: task.brief,
    traps: task.traps,
    needsApproval: task.needsApproval,
    manifest: task.manifest
      ? {
          name: task.manifest.name,
          href: task.manifest.href,
          rows: parseManifest(task.manifest.text).lines.length,
        }
      : null,
    expected: task.expected.map((expectation) => expectation.label),
  }));
}

/** Who signs on in an own Task. Sample Tasks carry the same in their briefs. */
export const OWN_OPERATOR = { id: "OPR7", password: "MERIDIA1" } as const;

/** Where an own Task starts: the port's Books as they stand, no traps armed. */
export function ownFixture(): Fixture {
  return {
    id: "own",
    books: baseBooks(),
    portTime: "2026-11-19T08:30",
    operator: { ...OWN_OPERATOR },
    idleSeconds: 240,
    locks: [],
  };
}

/** The line added to an own Task so the Operator can sign on. */
export const OWN_SIGN_ON = `Sign on to HARBOURMASTER as ${OWN_OPERATOR.id} with password ${OWN_OPERATOR.password}.`;
