import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { ConflictError } from "@/platform/errors";
import type { FirstView } from "../../domain/api";
import type { CallEvent } from "../../domain/contract";
import { resolveRulebook } from "../../domain/rules";
import type { BackOfficeRecord, RecordKind } from "../../domain/world";
import type { Caller, SwitchboardPorts } from "../ports";

/** The Owner's Workspace: its Back office, its trail, and the page's first view. */
export interface OfficeService {
  /** Makes the Workspace and seeds its Back office on first use; every entry point runs it first. */
  ensure(owner: Owner): Promise<void>;
  firstView(caller: Caller): Promise<FirstView>;
  records(owner: Owner, kind?: RecordKind): Promise<BackOfficeRecord[]>;
  /** The Back office back to its seed; the old Records are archived, never destroyed. */
  reset(owner: Owner): Promise<void>;
  trail(owner: Owner, before?: number): Promise<CallEvent[]>;
}

export function createOfficeService(ports: SwitchboardPorts): OfficeService {
  const { store, rate } = ports;
  return {
    ensure: (owner) => store.ensureWorkspace(owner),

    async firstView({ owner, visitor }) {
      const [records, versions, calls, rates] = await Promise.all([
        store.records(owner),
        store.ruleRows(owner),
        store.calls(owner),
        rate.used(visitor),
      ]);
      return {
        records,
        rules: { rulebook: resolveRulebook(versions), versions },
        calls,
        rates,
        sandbox: ports.sandboxConfigured(),
      };
    },

    async records(owner, kind) {
      const records = await store.records(owner);
      return kind ? records.filter((record) => record.kind === kind) : records;
    },

    async reset(owner) {
      if (!(await store.resetRecords(owner)))
        throw new ConflictError(
          "A Call is live. Hang up before resetting the Back office.",
        );
    },

    trail: (owner, before) => store.trail(owner, before),
  };
}
