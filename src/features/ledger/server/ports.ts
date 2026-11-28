import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type { AskSessionView, StoredBuild } from "../domain/build-events";
import type { BuildPlan, RawBuildPlan } from "../domain/build-plan";
import type { LimitHit } from "../domain/limits";

/*
 * What Ledger's service needs from outside the process. The container
 * (`container.ts`) wires the SQL in `repository.ts` and `rate-limit.ts` and
 * the planner; tests and the stubbed e2e suite hand in fakes or the canned
 * Build plans.
 */

/** Who a Ledger call is for: the Owner whose sessions it may read, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

export interface AskSessions {
  create(input: { owner: Owner; visitorHash: string }): Promise<string>;
  /** An Owner's Ask session with its Builds; null when it is missing or someone else's. */
  load(id: string, owner: Owner): Promise<AskSessionView | null>;
  insertBuild(input: {
    askSessionId: string;
    question: string;
    plan: BuildPlan;
    model: string;
    visitorHash: string;
  }): Promise<StoredBuild>;
  /** The Owner's newest session with an answer to show: where a limited visitor lands. */
  latestAnswered(owner: Owner): Promise<string | null>;
}

/**
 * The Build caps in Postgres (`ledger.take_rate_hit`): which cap a Build
 * would run into, or null. A trusted visitor (the e2e suite) is never counted.
 */
export interface BuildRate {
  /** Records one Build against the visitor's hour and the site's day, under a lock; null when it may run. */
  take(visitor: Visitor): Promise<LimitHit | null>;
  /** The same question without spending a hit. */
  peek(visitor: Visitor): Promise<LimitHit | null>;
}

type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;
export type PartialPlan = DeepPartial<RawBuildPlan>;

export type PlanStream = {
  /** The plan as it grows: each value replaces the last. */
  partials: AsyncIterable<PartialPlan>;
  plan: PromiseLike<RawBuildPlan>;
  model: string;
};

/** The model that plans a Build (paid), or the canned plans of the stubbed suite. */
export interface Planner {
  plan(input: { question: string; history: StoredBuild[] }): PlanStream;
}

export type LedgerPorts = {
  sessions: AskSessions;
  rate: BuildRate;
  planner: Planner;
};
