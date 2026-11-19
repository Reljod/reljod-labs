import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { type Access, requireOwner } from "@/features/access/server/gate";
import type { ActorKind } from "../domain/trail";
import { type Visitor, visitor } from "./rate";
import { ensureWorkspace } from "./workspace";

/**
 * Who a server function acts for. Every Canvas function that reads or writes
 * takes one, so the page, the chat and the MCP server go down the same path
 * with the same Owner scope, limits and Trail.
 */
export type Caller = {
  owner: Owner;
  visitor: Visitor;
  /** Who the Trail names: the person, the Analyst (a chat turn) or an outside MCP client. */
  actor: ActorKind;
  /** The Conversation a chat turn belongs to. */
  conversationId?: string;
  /** The Question being answered: its caps apply to every Run made for it. */
  questionId?: string;
};

/**
 * The Caller of a page request, route handler or server action: passes the
 * Access gate once, and makes the Owner's Workspace on first use.
 */
export async function requireCaller(): Promise<Caller> {
  return (await requireCallerAccess()).caller;
}

/** The same, with the Access it passed on: what a token for the MCP server is minted from. */
export async function requireCallerAccess(): Promise<{
  caller: Caller;
  access: Access;
}> {
  const [{ owner, access }, who] = await Promise.all([
    requireOwner(),
    visitor(),
  ]);
  await ensureWorkspace(owner);
  return { caller: { owner, visitor: who, actor: "person" }, access };
}
