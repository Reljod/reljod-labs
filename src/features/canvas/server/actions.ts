"use server";

import { z } from "zod";
import type { RuleEditError } from "../domain/rules";
import { requireCaller, requireCallerAccess } from "./caller";
import { deleteConversation } from "./conversations";
import { isSafeError, RuleEditRefused } from "./errors";
import { mintPastedToken } from "./mcp-token";
import { saveRules } from "./rules";

/*
 * Canvas's writes from the page. Every action passes the Access gate
 * through `requireCaller()` (a server action can be posted to any page) and
 * calls the same server function the MCP tool calls. Reads are GET routes.
 */

type Failed = { ok: false; error: string; errors?: RuleEditError[] };

const failed = (error: unknown): Failed => {
  if (error instanceof RuleEditRefused)
    return { ok: false, error: error.message, errors: error.errors };
  if (isSafeError(error)) return { ok: false, error: error.message };
  if (error instanceof z.ZodError)
    return { ok: false, error: "That request doesn't look right." };
  throw error;
};

const editsSchema = z
  .array(
    z.object({
      id: z.string().max(60),
      enabled: z.boolean().optional(),
      params: z.record(z.string().max(40), z.unknown()).optional(),
    }),
  )
  .min(1)
  .max(20);

/** Saves Rule edits as a new Version of the Owner's Rulebook. */
export async function saveRulesAction(
  edits: unknown,
): Promise<{ ok: true; version: number; changed: string[] } | Failed> {
  try {
    const caller = await requireCaller();
    const saved = await saveRules(caller, editsSchema.parse(edits));
    return { ok: true, version: saved.version, changed: saved.changed };
  } catch (error) {
    return failed(error);
  }
}

/** Deletes one of the Owner's Conversations and its Views. */
export async function deleteConversationAction(
  id: unknown,
): Promise<{ ok: true } | Failed> {
  try {
    const caller = await requireCaller();
    await deleteConversation(caller, z.string().uuid().parse(id));
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** A token for an outside MCP client (Claude) to act for this Owner. */
export async function mintTokenAction(): Promise<
  { ok: true; token: string; expiresAt: string } | Failed
> {
  try {
    const { caller, access } = await requireCallerAccess();
    return { ok: true, ...(await mintPastedToken(access, caller)) };
  } catch (error) {
    return failed(error);
  }
}
