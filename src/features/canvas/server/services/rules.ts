import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { ForbiddenError } from "@/platform/errors";
import type { RulesResponse } from "../../domain/api";
import { ownerCatalog } from "../../domain/catalog";
import {
  applyRuleEdits,
  DEFAULT_RULEBOOK_VERSION,
  defaultRulebook,
  type RuleEdit,
  ruleDef,
} from "../../domain/rules";
import { RuleEditRefused } from "../errors";
import type {
  Caller,
  RulebookRepository,
  RulebookVersion,
  UploadRepository,
} from "../ports";

/** How many saved Versions the Rules place lists. */
const HISTORY = 50;

/**
 * The Rules (ADR 0031): Defaults in code, the Owner's edits as Versions.
 * A bad value is refused where it was made; an edit that changes nothing
 * saves nothing. The Analyst never gets here (the MCP tool refuses it).
 */
export interface RuleService {
  /** The Owner's Rulebook now: their latest Version, or the Defaults (Version 0). */
  current(owner: Owner): Promise<RulebookVersion>;
  /** The Rules place: the Rulebook now and every saved Version. */
  read(owner: Owner): Promise<RulesResponse>;
  /** Saves edits as a new Version and answers the Rules place as it now is. */
  save(
    caller: Caller,
    edits: RuleEdit[],
  ): Promise<RulesResponse & { changed: string[] }>;
}

const DEFAULTS = (): RulebookVersion => ({
  version: DEFAULT_RULEBOOK_VERSION,
  rulebook: defaultRulebook(),
  changed: [],
  savedAt: null,
});

export function createRuleService(ports: {
  rulebooks: RulebookRepository;
  uploads: UploadRepository;
}): RuleService {
  const { rulebooks } = ports;
  const current = async (owner: Owner) =>
    (await rulebooks.latest(owner)) ?? DEFAULTS();

  const response = (
    now: RulebookVersion,
    history: RulesResponse["history"],
  ): RulesResponse => ({
    version: now.version,
    rulebook: now.rulebook,
    savedAt: now.savedAt,
    history,
  });

  return {
    current,

    async read(owner) {
      const [now, history] = await Promise.all([
        current(owner),
        rulebooks.history(owner, HISTORY),
      ]);
      return response(now, history);
    },

    async save(caller, edits) {
      // The Rules bind the Analyst; it does not get to change them. A person
      // edits them on the Rules place, or through a client they connected.
      if (caller.actor === "analyst")
        throw new ForbiddenError(
          "The Analyst may not edit Rules. The person can, on the Rules place.",
        );
      const [now, uploads] = await Promise.all([
        current(caller.owner),
        ports.uploads.ready(caller.owner),
      ]);
      const applied = applyRuleEdits(now.rulebook, edits, {
        tables: ownerCatalog(uploads).guard.tables,
      });
      if (applied.errors.length > 0) throw new RuleEditRefused(applied.errors);
      const saved =
        applied.changed.length === 0
          ? now
          : await rulebooks.save(
              caller,
              applied.rulebook,
              applied.changed,
              (version) => ({
                action: "rules.saved",
                summary: `Saved Rulebook v${version}: ${applied.changed
                  .map((id) => ruleDef(id)?.title ?? id)
                  .join("; ")}`,
                detail: {
                  version,
                  changed: applied.changed,
                  rules: Object.fromEntries(
                    applied.changed.map((id) => [id, applied.rulebook[id]]),
                  ),
                },
              }),
            );
      const history = await rulebooks.history(caller.owner, HISTORY);
      return { ...response(saved, history), changed: applied.changed };
    },
  };
}
