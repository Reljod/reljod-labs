import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { CHECKS } from "../../domain/checks";
import { decide } from "../../domain/rules/decision";
import {
  adjudicate,
  personFacts,
  type WatchlistEntry,
} from "../../domain/rules/screening";
import type { Decision, Hit, RunState } from "../../domain/run-state";
import { type CallCost, callOptions, trackCall } from "../llm";
import type { RunContext } from "./context";

const ADJUDICATE = `You are a sanctions and PEP screening analyst at a Meridian bank and trust company. For each potential match, compare the listed record with what the bank knows about its customer: date of birth, nationality, place of birth, gender, aliases and former names, ID numbers, occupation, and what any article says. Then dispose of it:
- false_positive: identifiers clearly differ. The reason is the discount note an MLRO will read: name the identifiers compared and how they differ.
- true_match: identifiers agree, so this is the listed person.
- inconclusive: too little to decide either way, or the evidence conflicts. Say what would settle it.
Each hit comes with a first proposal made from dates alone; agree or overrule it. Reasons: one or two sentences, specific, no hedging words.`;

const adjudicateSchema = z.object({
  hits: z.array(
    z.object({
      index: z.number(),
      disposition: z.enum(["false_positive", "true_match", "inconclusive"]),
      reason: z.string(),
    }),
  ),
});

const RELEVANT_KINDS = new Set([
  "customer_profile",
  "identity_document",
  "watchlist_entry",
  "adverse_media_article",
  "register_of_directors",
  "member_statement",
  "screening_alert",
]);

/** adjudicate with the model: the rules propose, the analyst-model disposes. */
export async function adjudicateWithModel(
  ctx: RunContext,
  state: RunState,
  watchlist: WatchlistEntry[],
): Promise<{ hits: Hit[]; cost: CallCost | null }> {
  const proposed = adjudicate(state, watchlist).patch?.hits ?? [];
  if (proposed.length === 0) return { hits: [], cost: null };
  const started = Date.now();
  const settings = ctx.settings.adjudicate;
  const documents = state.documents
    .filter(
      (document) =>
        document.kind && RELEVANT_KINDS.has(document.kind) && document.fields,
    )
    .map(
      (document) =>
        `${document.kind} "${document.name}": ${JSON.stringify(document.fields)}`,
    )
    .join("\n");
  const hitList = proposed
    .map(
      (hit, index) =>
        `#${index} ${hit.hitName} on ${hit.listSource} (${hit.listType}, ref ${hit.reference}, score ${hit.score}); listed DOB "${hit.hitDateOfBirth}", nationality "${hit.hitNationality}", aliases ${JSON.stringify(hit.aliases)}, listed for: ${hit.reason}. Raised on ${hit.screenedName} (${hit.role}); what the case knows: ${JSON.stringify(personFacts(state, hit.screenedName))}. Proposal: ${hit.disposition}: ${hit.dispositionReason}`,
    )
    .join("\n");
  const result = await generateText({
    ...callOptions(settings),
    instructions: ADJUDICATE,
    output: Output.object({ schema: adjudicateSchema }),
    messages: [
      {
        role: "user",
        content: `Hits:\n${hitList}\n\nDocuments in the case:\n${documents}`,
      },
    ],
  });
  const cost = await trackCall({
    purpose: "adjudicate",
    model: settings.model,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
    started,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
  });
  const hits = proposed.map((hit, index) => {
    const verdict = result.output.hits.find((item) => item.index === index);
    return verdict
      ? {
          ...hit,
          disposition: verdict.disposition,
          dispositionReason: verdict.reason,
        }
      : hit;
  });
  return { hits, cost };
}

const DECIDE = `You write the decision file for a reviewer at a Meridian pension and trust administrator. The recommendation is already decided by the rules; never change it. Write:
- summary: two or three plain sentences a busy senior reviewer can act on: what was asked, what the evidence shows, why the recommendation follows. Cite the key figures.
- nextSteps: up to four short imperative steps, most important first.
No em dashes. No hedging.`;

const decideSchema = z.object({
  summary: z.string(),
  nextSteps: z.array(z.string()),
});

/** decide: the rules pick the recommendation; the model writes it up. */
export async function decideWithModel(
  ctx: RunContext,
  state: RunState,
): Promise<{ decision: Decision; cost: CallCost | null }> {
  const base = decide(state).decision;
  const started = Date.now();
  const settings = ctx.settings.decide;
  try {
    const checks = state.checks
      .map(
        (check) =>
          `${CHECKS[check.id].title}: ${check.outcome} (${check.detail})`,
      )
      .join("\n");
    const result = await generateText({
      ...callOptions(settings),
      instructions: DECIDE,
      output: Output.object({ schema: decideSchema }),
      messages: [
        {
          role: "user",
          content: `Recommendation: ${base.recommendation}\nHeadline: ${base.headline}\nDocuments: ${state.documents.map((document) => `${document.name} (${document.kind ?? "unsorted"})`).join(", ")}\nMissing: ${state.gaps.map((gap) => gap.wants).join(", ") || "nothing"}\nChecks:\n${checks}${state.arrears ? `\nArrears: ${JSON.stringify(state.arrears)}` : ""}${state.risk ? `\nRisk: ${state.risk.rating} (${state.risk.factors.join(", ")})` : ""}${state.answers.length ? `\nReviewer said: ${state.answers.map((answer) => answer.text).join(" / ")}` : ""}`,
        },
      ],
    });
    const cost = await trackCall({
      purpose: "decide",
      model: settings.model,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      started,
      sessionId: ctx.sessionId,
      runId: ctx.runId,
    });
    return {
      decision: {
        ...base,
        summary: result.output.summary,
        nextSteps: result.output.nextSteps.slice(0, 4),
      },
      cost,
    };
  } catch {
    return { decision: base, cost: null };
  }
}
