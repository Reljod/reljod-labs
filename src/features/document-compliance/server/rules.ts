import "server-only";
import { db, jsonb } from "@/server/postgres";
import type { RuleRepository, SavedRuleVersion } from "./ports";

/** Rule Versions in `document_compliance.rule_versions`, on the shared pool. */
export const ruleRepository: RuleRepository = {
  async versions(owner, ruleId) {
    const sql = db();
    return sql<SavedRuleVersion[]>`
      select rule_id as "ruleId", version, enabled, params,
        restored_from as "restoredFrom", saved_by as "savedBy",
        created_at as "savedAt"
      from document_compliance.rule_versions
      where owner = ${owner}
      ${ruleId ? sql`and rule_id = ${ruleId}` : sql``}
      order by version desc`;
  },

  async saveVersion(input) {
    const sql = db();
    try {
      const [row] = await sql<{ version: number }[]>`
        select document_compliance.save_rule_version(
          p_owner => ${input.owner},
          p_rule_id => ${input.ruleId},
          p_enabled => ${input.enabled},
          p_params => ${jsonb(sql, input.params)},
          p_restored_from => ${input.restoredFrom}::integer,
          p_saved_by => ${input.savedBy},
          p_summary => ${input.summary},
          p_details => ${jsonb(sql, input.details)},
          p_max_per_hour => ${input.maxPerHour}::integer
        ) as version`;
      return { version: Number(row?.version) };
    } catch (error) {
      if (error instanceof Error && error.message.includes("limit_reached")) {
        return { refusal: "limit" };
      }
      throw error;
    }
  },
};
