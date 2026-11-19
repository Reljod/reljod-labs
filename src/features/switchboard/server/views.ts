import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { FirstView } from "../domain/api";
import { env } from "./env";
import { ratesUsed, type Visitor } from "./rate";
import { rulesView } from "./rules";
import { listCalls, listRecords } from "./store";

/** The page's first view, read together. */
export async function firstView(
  owner: Owner,
  who: Visitor,
): Promise<FirstView> {
  const [records, rules, calls, rates] = await Promise.all([
    listRecords(owner),
    rulesView(owner),
    listCalls(owner),
    ratesUsed(who),
  ]);
  return { records, rules, calls, rates, sandbox: env.sandboxConfigured() };
}
