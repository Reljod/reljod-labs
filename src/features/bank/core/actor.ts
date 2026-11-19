import type { Owner } from "@/features/access/domain/owner";
import type { ActorKind } from "../domain/audit";
import type { Via } from "../domain/commands";
import type { Staff } from "../domain/staff";

/**
 * Who a command runs as: the Owner whose bank it reaches, the Staff member
 * whose Role it is checked against, and how it arrived. The Teller and an
 * outside MCP client act as a Staff member too, and say so in the trail.
 */
export type Actor = {
  owner: Owner;
  staff: Staff;
  /** `workflow`: the bank itself, in a Workflow step (end-of-day, clearing). */
  via: Via | "workflow";
  /** The chat Session a Teller call belongs to. */
  sessionId?: string | null;
};

/** The bank acting for itself in a Workflow. It has no Staff row. */
export function systemActor(owner: Owner, name: string): Actor {
  return {
    owner,
    staff: {
      id: "",
      key: "system",
      name,
      title: "The bank",
      role: "supervisor",
      initials: "TB",
    },
    via: "workflow",
  };
}

/** The Staff id to store for an actor: null for the bank itself. */
export const staffIdOf = (actor: Pick<Actor, "staff">): string | null =>
  actor.staff.id || null;

export function actorKind(actor: Pick<Actor, "via">): ActorKind {
  if (actor.via === "chat") return "teller";
  if (actor.via === "mcp") return "client";
  if (actor.via === "workflow") return "system";
  return "staff";
}

export function actorLabel(actor: Pick<Actor, "via" | "staff">): string {
  if (actor.via === "chat") return `The Teller, for ${actor.staff.name}`;
  if (actor.via === "mcp") return `An MCP client, for ${actor.staff.name}`;
  return actor.staff.name;
}
