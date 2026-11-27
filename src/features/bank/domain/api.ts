import { z } from "zod";
import type { CommandName } from "./commands";
import { LIMITS } from "./limits";

/**
 * The bank's HTTP contract. Every read is `GET /api/bank/read/<command>`
 * and every write `POST /api/bank/commands/<command>` (one route each,
 * generated from the command list); the rest are the few resources a screen
 * needs (the active Staff member, MCP tokens, chat Sessions). The browser
 * calls them only through `components/api.ts`.
 */
export const API_ROOT = "/api/bank";
export const BANK_MCP_PATH = `${API_ROOT}/mcp`;
export const DEMO_PATH = "/demos/bank";

export const ROUTES = {
  command: (name: CommandName) => `${API_ROOT}/commands/${name}`,
  /** PUT: become another Staff member of the Owner's bank. */
  activeStaff: `${API_ROOT}/staff/active`,
  /** POST: a token for an outside MCP client. */
  tokens: `${API_ROOT}/tokens`,
  sessions: `${API_ROOT}/sessions`,
  session: (id: string) => `${API_ROOT}/sessions/${id}`,
  chat: (id: string) => `${API_ROOT}/sessions/${id}/chat`,
} as const;

/** Remembers which of the Owner's own Staff is active. Carries no authority. */
export const STAFF_COOKIE = "bank_staff";

export const commandParamsSchema = z.object({ name: z.string().max(60) });
export const sessionParamsSchema = z.object({ id: z.string().max(60) });

/** `?input=<JSON object>`: the read command's input, validated by its own schema in the engine. */
export const readQuerySchema = z.object({
  input: z
    .string()
    .max(8_000)
    .optional()
    .transform((raw, ctx): Record<string, unknown> => {
      if (!raw) return {};
      try {
        const value: unknown = JSON.parse(raw);
        if (value && typeof value === "object" && !Array.isArray(value))
          return value as Record<string, unknown>;
      } catch {}
      ctx.addIssue({ code: "custom", message: "The input is not valid JSON." });
      return z.NEVER;
    }),
});

/** One write command. The browser makes the idempotency key per click, so a click sent twice runs once. */
export const commandBodySchema = z.object({
  input: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8).max(120),
});

export const activeStaffSchema = z.object({ staffId: z.string().uuid() });

export const newSessionSchema = z.object({
  customerId: z.string().uuid().nullable(),
});

export const chatBodySchema = z.object({
  text: z.string().max(LIMITS.messageChars),
});

export const readPath = (
  name: CommandName,
  input: Record<string, unknown> = {},
) => {
  const entries = Object.entries(input).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  const query =
    entries.length > 0
      ? `?input=${encodeURIComponent(JSON.stringify(Object.fromEntries(entries)))}`
      : "";
  return `${API_ROOT}/read/${name}${query}`;
};

export const TABS = [
  "bank",
  "chat",
  "operations",
  "growth",
  "rules",
  "audit",
  "hood",
  "connect",
] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  bank: "Bank",
  chat: "Teller",
  operations: "Operations",
  growth: "Growth",
  rules: "Rules",
  audit: "Audit",
  hood: "Under the hood",
  connect: "Connect a client",
};

export const isTab = (value: unknown): value is Tab =>
  typeof value === "string" && (TABS as readonly string[]).includes(value);

export type McpTokenResponse = {
  token: string;
  url: string;
  expiresAt: string;
  staffName: string;
};
