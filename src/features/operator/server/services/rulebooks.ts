import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, LimitError } from "@/platform/errors";
import type { RulebookVersion } from "../../domain/contract";
import { LIMITS } from "../../domain/limits";
import { type Rulebook, rulebookSchema } from "../../domain/rules";
import type { RulebookStore } from "../ports";
import type { Caller } from "./runs";

/*
 * The Rulebook: the Rules as data, versioned per Owner (ADR 0025). Version 0
 * is the Default, in code; every save is the Owner's next version, and a Run
 * keeps the version it started under.
 */

export interface RulebookService {
  current(owner: Owner): Promise<{ version: number; rulebook: Rulebook }>;
  /** Every version, newest first, then the Default: the first is current. */
  versions(owner: Owner): Promise<RulebookVersion[]>;
  /** Saves an edit as the Owner's next version, under the daily cap. */
  save(
    caller: Caller,
    input: { rulebook: unknown; note?: string | null },
  ): Promise<{ version: number }>;
}

export function createRulebookService(store: RulebookStore): RulebookService {
  return {
    current: (owner) => store.current(owner),
    versions: (owner) => store.versions(owner),
    async save(caller, input) {
      const rulebook = rulebookSchema.safeParse(input.rulebook);
      if (!rulebook.success)
        throw new InvalidError(
          rulebook.error.issues
            .slice(0, 3)
            .map(
              (issue) =>
                `${issue.path.join(".") || "rulebook"}: ${issue.message}`,
            )
            .join("; "),
        );
      const note =
        typeof input.note === "string" && input.note.trim()
          ? input.note.trim().slice(0, 500)
          : null;
      const saved = await store.insert(
        caller.owner,
        rulebook.data,
        note,
        caller.visitor.trusted ? null : LIMITS.rulebooksPerOwnerPerDay,
      );
      if ("refusal" in saved) throw new LimitError(saved.refusal);
      return saved;
    },
  };
}
