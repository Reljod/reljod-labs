import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, LimitError } from "@/platform/errors";
import {
  type DocumentKind,
  METRIC_IDS,
  METRICS,
  type MetricId,
  type Weight,
} from "../../domain/contract";
import { MANIFEST, RECORDED } from "../../domain/corpus";
import { LIMITS } from "../../domain/limits";
import {
  parseRulebook,
  type Rulebook,
  type RulebookVersion,
  ruleSentence,
  withRule,
} from "../../domain/rules";
import { type Calibration, calibrate, overall } from "../../domain/score";
import type { LoupePorts, Who } from "../ports";

export type Saved = { version: number; changes: string[] };

/** One Rule edit from an MCP client: a Rule's Parameters or the Policy. */
export type RuleEdit = {
  rule?: MetricId;
  threshold?: number;
  weight?: Weight;
  enabled?: boolean;
  kinds?: DocumentKind[];
  policy?: Partial<Rulebook["policy"]>;
  note?: string;
};

/** An Owner's Rulebook: its versions, edits, and how it does on the Corpus. */
export interface RulebookService {
  /** Every version, newest first, then the Defaults; the first is current. */
  list(owner: Owner): Promise<RulebookVersion[]>;
  /**
   * Saves a Rulebook as the Owner's next version: validated against the
   * schema and each Rule's bounds, capped per day, with its Audit event in
   * the same transaction.
   */
  save(who: Who, input: { rulebook: unknown; note?: unknown }): Promise<Saved>;
  /** Changes one Rule or the Policy of the current version, and saves the result. */
  edit(who: Who, edit: RuleEdit): Promise<Saved>;
  /** The current Rulebook, each Rule with its sentence. */
  rules(owner: Owner): Promise<{
    version: number;
    rules: Record<string, unknown>[];
    policy: Rulebook["policy"];
  }>;
  /** How the model-free Sweep under the current Rulebook does on the Corpus. */
  calibration(owner: Owner): Promise<
    Calibration & {
      rulebookVersion: number;
      overall: ReturnType<typeof overall>;
    }
  >;
}

export function createRulebookService(
  ports: Pick<LoupePorts, "rulebooks">,
): RulebookService {
  const { rulebooks } = ports;

  async function save(
    who: Who,
    input: { rulebook: unknown; note?: unknown },
  ): Promise<Saved> {
    const parsed = parseRulebook(input.rulebook);
    if (!parsed.ok) throw new InvalidError(parsed.error);
    const note =
      typeof input.note === "string" && input.note.trim()
        ? input.note.trim().slice(0, 500)
        : null;
    const saved = await rulebooks.insert({
      owner: who.owner,
      rulebook: parsed.rulebook,
      note,
      perDay: who.visitor.trusted ? null : LIMITS.rulebooksPerOwnerPerDay,
      via: who.via,
    });
    if ("over" in saved)
      throw new LimitError(
        `That's ${saved.over} Rulebook versions today, the demo's daily limit. Try again tomorrow.`,
      );
    if ("unchanged" in saved)
      throw new InvalidError("Nothing changed, so no new version was saved.");
    return saved;
  }

  return {
    list: (owner) => rulebooks.list(owner),

    save,

    async edit(who, edit) {
      const current = await rulebooks.current(who.owner);
      let next = current.rulebook;
      if (edit.rule) {
        next = withRule(next, edit.rule, {
          ...(edit.threshold !== undefined
            ? { threshold: edit.threshold }
            : {}),
          ...(edit.weight ? { weight: edit.weight } : {}),
          ...(edit.enabled !== undefined ? { enabled: edit.enabled } : {}),
          ...(edit.kinds ? { kinds: edit.kinds } : {}),
        });
      }
      if (edit.policy)
        next = { ...next, policy: { ...next.policy, ...edit.policy } };
      return save(who, { rulebook: next, note: edit.note });
    },

    async rules(owner) {
      const current = await rulebooks.current(owner);
      return {
        version: current.version,
        rules: METRIC_IDS.map((id) => ({
          id,
          label: METRICS[id].label,
          sentence: ruleSentence(id, current.rulebook.rules[id].threshold),
          ...current.rulebook.rules[id],
        })),
        policy: current.rulebook.policy,
      };
    },

    async calibration(owner) {
      const current = await rulebooks.current(owner);
      const calibration = calibrate(MANIFEST, RECORDED, current.rulebook);
      return {
        rulebookVersion: current.version,
        overall: overall(calibration),
        ...calibration,
      };
    },
  };
}
