/**
 * The Samples' answer keys, written by `pnpm render:floorwalk-samples` from
 * the render itself: when each planted problem (and each decoy) was in view,
 * and where on screen at its clearest. Never edited by hand.
 */
import keys from "./answer-key.generated.json";
import type { AnswerKey } from "./walk";

const ANSWER_KEYS = keys as unknown as Record<string, AnswerKey>;

export function answerKeyFor(slug: string): AnswerKey | null {
  return ANSWER_KEYS[slug] ?? null;
}
