import type { Actor } from "../../core/actor";
import { assertAllowed } from "../../core/engine";
import { InvalidError } from "../../core/errors";
import { commandDef, type WriteOutcome } from "../../domain/commands";
import type {
  BankRate,
  Caller,
  CommandEngine,
  GrowthReader,
  Later,
  Outbox,
} from "../ports";

/*
 * The two doors into the bank. The app's routes, the page, the MCP tools
 * and the Teller all come through here, so every caller gets the same
 * engine (validation, Roles, Rules, idempotency, Confirmation,
 * maker-checker, Audit), the same hourly cap and the same outbox dispatch.
 */

/** Commands after which a sleeping Workflow should look again at once. */
const WAKES = new Set([
  "advance_clock",
  "decide_alert",
  "decide_approval",
  "confirm_request",
]);

/** Reads that also nudge the outbox, so Operations never shows a stuck queue. */
const KICKS = new Set(["get_operations", "get_overview"]);

export interface CommandService {
  /** One read command, scoped to the actor's Owner by the engine. */
  read(actor: Actor, name: string, input: unknown): Promise<unknown>;
  /**
   * One write command. The visitor's hourly write cap is taken before the
   * engine runs, and the outbox is dispatched once the write is committed.
   */
  write(
    caller: Caller,
    name: string,
    input: unknown,
    idempotencyKey?: string | null,
  ): Promise<WriteOutcome>;
}

export type CommandPorts = {
  engine: CommandEngine;
  growth: GrowthReader;
  outbox: Outbox;
  rate: BankRate;
  later: Later;
};

export function createCommandService(ports: CommandPorts): CommandService {
  const { engine, growth, outbox, rate } = ports;
  return {
    async read(actor, name, input) {
      const def = commandDef(name);
      if (def?.kind !== "read")
        throw new InvalidError("There is no such read.");
      if (name === "list_growth") {
        // Growth reads GitHub as well as the database: the Role check is the engine's own.
        assertAllowed(def, actor);
        return growth.view(actor.owner);
      }
      const result = await engine.read(actor, name, input);
      if (KICKS.has(name)) ports.later(() => outbox.kick(actor.owner));
      return result;
    },

    async write({ actor, visitor }, name, input, idempotencyKey = null) {
      if (commandDef(name)?.kind !== "write")
        throw new InvalidError("There is no such command.");
      await rate.take("write", visitor, { owner: actor.owner });
      const outcome = await engine.write(actor, name, input, idempotencyKey);
      // The write is committed, and so is its outbox message: start its Workflow.
      await outbox.kick(actor.owner, { wake: WAKES.has(name) });
      return outcome;
    },
  };
}
