import type { Owner } from "@/features/access/domain/owner";
import {
  type Params,
  type Rulebook,
  type RuleVersion,
  resolveRulebook,
} from "../domain/rules";
import type { Db } from "./db";

type Row = {
  ruleId: string;
  version: number;
  enabled: boolean;
  params: Params;
  note: string;
  staffName: string;
  createdAt: string;
};

/** The Rulebook an Owner's bank runs on right now: Defaults and their latest Versions. */
export async function loadRulebook(db: Db, owner: Owner): Promise<Rulebook> {
  const rows = await db<Row[]>`
    select distinct on (rule_id) rule_id, version, enabled, params, note,
           staff_name, created_at
    from bank.rule_versions
    where owner = ${owner}
    order by rule_id, version desc`;
  return resolveRulebook(rows);
}

export async function ruleHistory(
  db: Db,
  owner: Owner,
  ruleId: string,
): Promise<RuleVersion[]> {
  return db<Row[]>`
    select rule_id, version, enabled, params, note, staff_name, created_at
    from bank.rule_versions
    where owner = ${owner} and rule_id = ${ruleId}
    order by version desc`;
}

/** The bank's clock, read once per command. */
export async function bankClock(
  db: Db,
  owner: Owner,
): Promise<{ now: string; today: string }> {
  const [row] = await db<{ now: string; today: string }[]>`
    select bank.now(${owner}) as now, bank.today(${owner}) as today`;
  if (!row) throw new Error("The bank has no clock");
  return row;
}
