"use server";

import { DENIED_MESSAGE } from "@/features/access/constants";
import { type Owner, ownerOf } from "@/features/access/domain/owner";
import { currentAccess } from "@/features/access/server/gate";
import type { AuditActor } from "../domain/audit";
import { isRuleId, type RuleEdit, type RuleId } from "../domain/rules";
import { actorOf } from "./audit";
import {
  type RuleWriteResult,
  restoreRule as restore,
  saveRule as save,
} from "./rules";

/** Runs a Rule write for the signed-in Owner, turning a server error into a message. */
async function withRule(
  what: string,
  ruleId: string,
  work: (
    owner: Owner,
    actor: AuditActor,
    ruleId: RuleId,
  ) => Promise<RuleWriteResult>,
): Promise<RuleWriteResult> {
  try {
    const access = await currentAccess();
    if (!access) return { ok: false, message: DENIED_MESSAGE };
    if (!isRuleId(ruleId)) return { ok: false, message: "No such Rule." };
    return await work(ownerOf(access), actorOf(access), ruleId);
  } catch (error) {
    console.error(`[document-compliance] could not ${what}`, error);
    return {
      ok: false,
      message: `Could not ${what} because of a server error. Try again in a moment.`,
    };
  }
}

/** Saves an edit to a Rule as its next Version. */
export async function saveRule(
  ruleId: string,
  edit: RuleEdit,
): Promise<RuleWriteResult> {
  return withRule("save the Rule", ruleId, (owner, actor, id) =>
    save(owner, actor, id, { enabled: edit?.enabled, params: edit?.params }),
  );
}

/** Puts an earlier Version (0 for the Default) back in force as the next Version. */
export async function restoreRule(
  ruleId: string,
  version: number,
): Promise<RuleWriteResult> {
  if (!Number.isInteger(version) || version < 0) {
    return { ok: false, message: "No such Version." };
  }
  return withRule("restore the Rule", ruleId, (owner, actor, id) =>
    restore(owner, actor, id, version),
  );
}
