import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, LimitError } from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import type { SaveRulebookRequest } from "../../domain/api";
import { type RulebookVersion, rulebookSchema } from "../../domain/contract";
import { LIMITS } from "../../domain/limits";
import type { SievePorts } from "../ports";

/** The Owner's versioned Rulebook: every save is a new version, and every Run records the one it ran under. */
export interface RulebookService {
  /** Every version the Owner saved, newest first, then the default: the first is the current one. */
  versions(owner: Owner): Promise<RulebookVersion[]>;
  current(owner: Owner): Promise<RulebookVersion>;
  /** Saves the Rulebook as the Owner's next version, under the daily cap. */
  save(
    caller: { owner: Owner; visitor: Visitor },
    input: SaveRulebookRequest,
  ): Promise<RulebookVersion>;
}

export function createRulebookService(
  ports: Pick<SievePorts, "rulebooks" | "now">,
): RulebookService {
  return {
    versions: (owner) => ports.rulebooks.versions(owner),
    current: (owner) => ports.rulebooks.current(owner),

    async save({ owner, visitor }, input) {
      const parsed = rulebookSchema.safeParse(input.rulebook);
      if (!parsed.success)
        throw new InvalidError(
          parsed.error.issues
            .slice(0, 3)
            .map(
              (issue) =>
                `${issue.path.join(".") || "rulebook"}: ${issue.message}`,
            )
            .join("; "),
        );
      const rulebook = parsed.data;
      if (rulebook.dropBelow > rulebook.reviewBelow)
        throw new InvalidError("Drop below must not be above review below.");
      const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
      const saved = await ports.rulebooks.save(
        owner,
        rulebook,
        note,
        visitor.trusted ? null : LIMITS.rulebooksPerOwnerPerDay,
      );
      if ("refusal" in saved) throw new LimitError(saved.refusal);
      return {
        version: saved.version,
        rulebook,
        note,
        createdAt: new Date(ports.now()).toISOString(),
      };
    },
  };
}
