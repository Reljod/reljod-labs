import "server-only";
import { after } from "next/server";
import { pgRateLimiter } from "@/platform/rate/limiter";
import { container } from "@/platform/services/container";
import { auditIn } from "../core/audit";
import { runRead, runWrite } from "../core/engine";
import { BANK_MCP_PATH } from "../domain/api";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { growthView } from "./growth";
import { tokenSigner } from "./mcp-auth";
import { kick } from "./outbox";
import type {
  AuditLog,
  CommandEngine,
  Later,
  Sandboxes,
  SpendKind,
  Teller,
} from "./ports";
import { createChatService } from "./services/chat";
import { createCommandService } from "./services/commands";
import { createSessionService } from "./services/sessions";
import { createStaffService } from "./services/staff";
import { sessionRepository } from "./sessions";
import { staffRepository } from "./staff";

/** The bank's hourly caps, per visitor (`LIMITS`), counted in `bank.rate_hits`. */
const rate = pgRateLimiter<SpendKind>({
  table: "bank.rate_hits",
  owner: true,
  caps: {
    message: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.messagesPerHour,
        message: `That's ${LIMITS.messagesPerHour} messages this hour. Try again soon.`,
      },
    ],
    write: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.writesPerHour,
        message: `That's ${LIMITS.writesPerHour} changes this hour. Try again soon.`,
      },
    ],
    sandbox: [
      {
        scope: "visitor",
        window: "hour",
        max: LIMITS.sandboxRunsPerHour,
        message: `That's ${LIMITS.sandboxRunsPerHour} Sandbox runs this hour. Try again soon.`,
      },
    ],
  },
});

/** The command engine of `core/`, on the bank's own pool. */
const engine: CommandEngine = {
  read: (actor, name, input) => runRead(sql(), actor, name, input),
  write: (actor, name, input, idempotencyKey) =>
    runWrite(sql(), actor, name, input, { idempotencyKey }),
};

const audit: AuditLog = {
  async record(actor, event) {
    await auditIn(sql(), { actor }, event);
  },
};

/** After the response (a bare promise may be frozen once it is sent); outside a request, now. */
const later: Later = (work) => {
  try {
    after(work);
  } catch {
    void work().catch((error) => console.error("[bank] later", error));
  }
};

/*
 * The Teller (the AI SDK, the MCP client and server) and the Sandbox SDK are
 * loaded on first use, so the read and write routes, which never need them,
 * do not load them on a cold start.
 */
const sandboxes: Sandboxes = {
  dispose: async (sessionId) =>
    (await import("./sandbox")).disposeSandbox(sessionId),
};
const noSandboxes: Sandboxes = { dispose: async () => {} };

function lazyTeller(make: (chat: typeof import("./chat")) => Teller): Teller {
  let teller: Teller | undefined;
  return {
    async *answer(turn, signal) {
      teller ??= make(await import("./chat"));
      yield* teller.answer(turn, signal);
    },
  };
}

/**
 * The bank's composition root. `stub` (the e2e suite, unless it sends
 * `x-e2e-live: 1`) swaps the paid adapters only: the canned Teller for the
 * model, and no Sandbox. The engine, the database, the gates and the caps
 * stay real.
 */
export const bank = container(({ stub }) => {
  const commands = createCommandService({
    engine,
    growth: { view: growthView },
    outbox: { kick },
    rate,
    later,
  });
  const tellerPorts = { commands, tokens: tokenSigner };
  return {
    commands,
    staff: createStaffService({
      staff: staffRepository,
      audit,
      tokens: tokenSigner,
      mcpPath: BANK_MCP_PATH,
    }),
    sessions: createSessionService({
      sessions: sessionRepository,
      sandboxes: stub ? noSandboxes : sandboxes,
      later,
    }),
    chat: createChatService({
      sessions: sessionRepository,
      rate,
      teller: lazyTeller((chat) =>
        stub
          ? chat.createStubTeller(tellerPorts)
          : chat.createLiveTeller(tellerPorts),
      ),
    }),
  };
});

export type BankServices = ReturnType<typeof bank>;
