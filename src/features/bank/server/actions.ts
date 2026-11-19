"use server";

import { getPublicOrigin } from "mcp-handler";
import { headers } from "next/headers";
import { z } from "zod";
import type { ApiError, McpTokenResponse } from "../domain/api";
import type { SessionSummary } from "../domain/chat";
import { commandDef, type WriteOutcome } from "../domain/commands";
import type { Staff } from "../domain/staff";
import { write } from "./bank";
import { actorOf, requireStaff, switchStaff } from "./context";
import { mintToken } from "./mcp-auth";
import { refusalOf } from "./respond";
import { disposeSandbox } from "./sandbox";
import { createSession, deleteSession, setSession } from "./sessions";

/*
 * The app's writes. Every action passes the gate itself (`requireStaff`: a
 * server action can be posted to any page) and answers `{ ok }` rather than
 * throwing, so the button that sent it can show what happened.
 */

export type ActionResult<T> = ({ ok: true } & T) | ({ ok: false } & ApiError);

async function answer<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await work()) };
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal) {
      return {
        ok: false,
        error: refusal.message,
        ...(refusal.errors
          ? { errors: refusal.errors as ApiError["errors"] }
          : {}),
      };
    }
    // AccessDeniedError and anything unexpected: the framework's own handling.
    throw error;
  }
}

const commandSchema = z.object({
  name: z.string().max(60),
  input: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8).max(120),
});

/**
 * Runs one write command of the bank as the Staff member signed in. The
 * browser sends an idempotency key it made for this click, so a click sent
 * twice runs once.
 */
export async function bankCommand(
  name: string,
  input: Record<string, unknown>,
  idempotencyKey: string,
): Promise<ActionResult<{ outcome: WriteOutcome }>> {
  return answer(async () => {
    const context = await requireStaff();
    const call = commandSchema.parse({ name, input, idempotencyKey });
    if (commandDef(call.name)?.kind !== "write") {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["name"],
          message: "There is no such command.",
          input: call.name,
        },
      ]);
    }
    return {
      outcome: await write(
        actorOf(context),
        context.visitor,
        call.name,
        call.input,
        call.idempotencyKey,
      ),
    };
  });
}

export async function switchStaffAction(
  staffId: string,
): Promise<ActionResult<{ staff: Staff }>> {
  return answer(async () => ({
    staff: await switchStaff(z.string().uuid().parse(staffId)),
  }));
}

/** A token for an outside MCP client, acting as the Staff member signed in now. */
export async function mintTokenAction(): Promise<
  ActionResult<McpTokenResponse>
> {
  return answer(async () => {
    const context = await requireStaff();
    const requestHeaders = await headers();
    const host =
      requestHeaders.get("x-forwarded-host") ??
      requestHeaders.get("host") ??
      "localhost";
    const proto =
      requestHeaders.get("x-forwarded-proto") ??
      (host.startsWith("localhost") ? "http" : "https");
    const origin = getPublicOrigin(
      new Request(`${proto}://${host}/`, { headers: requestHeaders }),
    );
    return mintToken(context, origin);
  });
}

export async function createSessionAction(
  customerId: string | null,
): Promise<ActionResult<{ session: SessionSummary }>> {
  return answer(async () => {
    const context = await requireStaff();
    return {
      session: await createSession(context.owner, context.staff.id, customerId),
    };
  });
}

export async function focusSessionAction(
  sessionId: string,
  customerId: string | null,
): Promise<ActionResult<{ session: SessionSummary }>> {
  return answer(async () => {
    const context = await requireStaff();
    return {
      session: await setSession(
        context.owner,
        z.string().uuid().parse(sessionId),
        { customerId },
      ),
    };
  });
}

export async function deleteSessionAction(
  sessionId: string,
): Promise<ActionResult<{ deleted: string }>> {
  return answer(async () => {
    const context = await requireStaff();
    const id = z.string().uuid().parse(sessionId);
    await deleteSession(context.owner, id);
    await disposeSandbox(id);
    return { deleted: id };
  });
}
