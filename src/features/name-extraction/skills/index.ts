import type { SkillId } from "../domain/contract";
import { aliasResolution } from "./alias-resolution";
import { amlNamePatterns } from "./aml-name-patterns";
import { longDocumentTriage } from "./long-document-triage";
import { recallAudit } from "./recall-audit";
import { sandboxCoding } from "./sandbox-coding";

export type Skill = { title: string; description: string; body: string };

/**
 * The Analyst's Skills: playbooks loaded on demand with `load_skill`. Only
 * the one-line description sits in the system prompt until then. Plain
 * strings, safe to import in the browser (the page shows them).
 */
export const SKILLS: Record<SkillId, Skill> = {
  "long-document-triage": longDocumentTriage,
  "aml-name-patterns": amlNamePatterns,
  "alias-resolution": aliasResolution,
  "recall-audit": recallAudit,
  "sandbox-coding": sandboxCoding,
};
