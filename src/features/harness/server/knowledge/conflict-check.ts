import "server-only";
import { generateText, Output } from "ai";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditUsage } from "../../domain/audit";
import type { Resolution } from "../../domain/knowledge";
import {
  acceptVerdicts,
  CONFLICT_SYSTEM,
  choosePassagesToCheck,
  conflictPrompt,
  type Neighbour,
  queryOf,
  selectCandidates,
  verdictSchema,
} from "../../domain/knowledge/conflicts";
import { LIMITS } from "../../domain/limits";
import { sql } from "../db";
import { env } from "../env";
import { stepModel, toVector, usageOf } from "../llm";
import { type HitRow, hitOf } from "./views";

/**
 * The Conflict check of ADR 0016. For the new Passages of a Source, find the
 * close old Passages of other Sources with `harness.search_passages`, then
 * ask the step model one question per new Passage: do these state different
 * values for the same fact? Nothing is written here and nothing is
 * superseded: the caller records what is found, and a person settles it.
 */

/** New Passages checked at once. The pool holds four connections. */
const CONCURRENCY = 3;
const NEIGHBOURS = 8;

export type CheckedPassage = {
  id: number;
  heading: string | null;
  body: string;
  embedding: number[] | null;
};

export type FoundConflict = {
  newPassageId: number;
  oldPassageId: number;
  summary: string;
  proposal: Resolution;
  reasoning: string;
  /** What the model call that found it cost; only the first Conflict of a call carries it. */
  usage: AuditUsage | null;
};

export type CheckResult = {
  found: FoundConflict[];
  /** Model calls that found no Conflict: their cost belongs to the Source, not to a Conflict. */
  quietUsage: AuditUsage[];
  /** New Passages that had old ones to compare with and were asked about. */
  asked: number;
  /** New Passages not checked: over the cap, or the time ran out. */
  skipped: number;
  /** Checks that failed (the search or the model); the Source is still filed. */
  failed: number;
};

async function neighboursOf(
  owner: Owner,
  passage: CheckedPassage,
): Promise<{ neighbour: Neighbour; hit: ReturnType<typeof hitOf> }[]> {
  const vector = passage.embedding ? toVector(passage.embedding) : null;
  const rows = await sql()<HitRow[]>`
    select * from harness.search_passages(
      ${owner}, ${queryOf(passage)}, ${vector}::extensions.vector, ${NEIGHBOURS})`;
  return rows.map((row) => {
    const hit = hitOf(row);
    return {
      hit,
      neighbour: {
        passageId: hit.passageId,
        sourceId: hit.sourceId,
        score: hit.score,
        semantic: hit.semantic,
        lexical: hit.lexical,
      },
    };
  });
}

export async function checkForConflicts(input: {
  owner: Owner;
  source: { id: string; title: string; documentDate: string | null };
  passages: CheckedPassage[];
  /** `Date.now()` after which no new check is started. */
  deadline: number;
  cap?: number;
}): Promise<CheckResult> {
  const cap = input.cap ?? LIMITS.passagesCheckedPerSource;
  const chosen = choosePassagesToCheck(input.passages, cap);
  const result: CheckResult = {
    found: [],
    quietUsage: [],
    asked: 0,
    skipped: Math.max(0, input.passages.length - chosen.length),
    failed: 0,
  };
  const queue = [...chosen];

  const checkOne = async (index: number) => {
    const passage = input.passages[index];
    if (!passage) return;
    try {
      const near = await neighboursOf(input.owner, passage);
      const picked = selectCandidates(
        input.source.id,
        near.map((entry) => entry.neighbour),
        { embedded: passage.embedding !== null },
      );
      const candidates = picked.flatMap((neighbour) => {
        const entry = near.find(
          (item) => item.hit.passageId === neighbour.passageId,
        );
        return entry ? [entry.hit] : [];
      });
      if (candidates.length === 0) return;

      result.asked++;
      const model = env.stepModel();
      const answer = await generateText({
        model: stepModel(),
        instructions: CONFLICT_SYSTEM,
        output: Output.object({ schema: verdictSchema }),
        prompt: conflictPrompt(
          {
            sourceTitle: input.source.title,
            documentDate: input.source.documentDate,
            heading: passage.heading,
            body: passage.body,
          },
          candidates.map((hit) => ({
            sourceTitle: hit.sourceTitle,
            documentDate: hit.documentDate,
            heading: hit.heading,
            body: hit.body,
          })),
        ),
        temperature: 0,
        maxOutputTokens: 900,
      });
      const usage = usageOf({
        model,
        usage: answer.usage,
        providerMetadata: answer.providerMetadata,
      });
      const accepted = acceptVerdicts(
        answer.output.verdicts,
        candidates,
        input.source.documentDate,
      );
      if (accepted.length === 0) {
        result.quietUsage.push(usage);
        return;
      }
      accepted.forEach((conflict, order) => {
        const old = candidates[conflict.candidate];
        if (!old) return;
        result.found.push({
          newPassageId: passage.id,
          oldPassageId: old.passageId,
          summary: conflict.summary,
          proposal: conflict.proposal,
          reasoning: conflict.reasoning,
          usage: order === 0 ? usage : null,
        });
      });
    } catch (error) {
      result.failed++;
      console.error("[harness] Conflict check failed for a Passage", error);
    }
  };

  const worker = async () => {
    for (;;) {
      if (Date.now() > input.deadline) {
        result.skipped += queue.length;
        queue.length = 0;
        return;
      }
      const next = queue.shift();
      if (next === undefined) return;
      await checkOne(next);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}
