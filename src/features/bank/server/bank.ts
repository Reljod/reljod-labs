import "server-only";
import type { Actor } from "../core/actor";
import { runRead, runWrite } from "../core/engine";
import type { WriteOutcome } from "../domain/commands";
import { sql } from "./db";
import { growthView } from "./growth";
import { kick } from "./outbox";
import { takeRate, type Visitor } from "./rate";

/*
 * The two doors into the bank. The app's routes and actions, the MCP tools
 * and the Teller all come through here, so every caller gets the same
 * engine (validation, Roles, Rules, idempotency, confirmation,
 * maker-checker, Audit), the same hourly cap and the same outbox dispatch.
 */

/** Commands after which a sleeping Workflow should look again at once. */
const WAKES = new Set(["advance_clock", "decide_alert", "decide_approval", "confirm_request"]);

/** Reads that also nudge the outbox, so Operations never shows a stuck queue. */
const KICKS = new Set(["get_operations", "get_overview"]);

export async function read(actor: Actor, name: string, input: unknown): Promise<unknown> {
  if (name === "list_growth") {
    // Growth reads GitHub as well as the database; the Role check is the engine's.
    await runRead(sql(), actor, "get_overview", {});
    return growthView(actor.owner);
  }
  const result = await runRead(sql(), actor, name, input);
  if (KICKS.has(name)) void kick(actor.owner);
  return result;
}

export async function write(
  actor: Actor,
  visitor: Visitor,
  name: string,
  input: unknown,
  idempotencyKey?: string | null,
): Promise<WriteOutcome> {
  await takeRate(visitor, actor.owner, "write");
  const outcome = await runWrite(sql(), actor, name, input, { idempotencyKey });
  // The write is committed, and so is its outbox message: start its Workflow.
  await kick(actor.owner, { wake: WAKES.has(name) });
  return outcome;
}
