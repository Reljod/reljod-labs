import "server-only";
import { LIMITS } from "../domain/limits";
import { parseRulebook } from "../domain/rules";
import type { Who } from "./examinations";
import { insertRulebook } from "./repository";

/**
 * Saves a Rulebook as the Owner's next version, for the app and the MCP
 * server alike: validated against the schema and each Rule's bounds, capped
 * per day, with its Audit event in the same transaction.
 */
export async function saveRulebookFor(
  who: Who,
  input: { rulebook: unknown; note?: unknown },
): Promise<{ version: number; changes: string[] } | { error: string }> {
  const parsed = parseRulebook(input.rulebook);
  if (!parsed.ok) return { error: parsed.error };
  const note =
    typeof input.note === "string" && input.note.trim()
      ? input.note.trim().slice(0, 500)
      : null;
  const saved = await insertRulebook({
    owner: who.owner,
    rulebook: parsed.rulebook,
    note,
    perDay: who.visitor.trusted ? null : LIMITS.rulebooksPerOwnerPerDay,
    via: who.via,
  });
  return "refusal" in saved ? { error: saved.refusal } : saved;
}
