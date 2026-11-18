import type { CommandName } from "./commands";

/**
 * The bank's HTTP contract. Reads are gated GET routes (one per read
 * command, generated from the command list); writes are server actions.
 * The browser calls them only through `components/api.ts`.
 */
export const API_ROOT = "/api/bank";
export const BANK_MCP_PATH = `${API_ROOT}/mcp`;
export const DEMO_PATH = "/demos/bank";

/** Remembers which of the Owner's own Staff is active. Carries no authority. */
export const STAFF_COOKIE = "bank_staff";

/** e2e only, with the bypass token: a canned Teller turn, no model spend. */
export const CHAT_STUB_HEADER = "x-bank-stub";

export const readPath = (name: CommandName, input: Record<string, unknown> = {}) => {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "");
  const query = entries.length > 0 ? `?input=${encodeURIComponent(JSON.stringify(Object.fromEntries(entries)))}` : "";
  return `${API_ROOT}/read/${name}${query}`;
};

export const TABS = ["bank", "chat", "operations", "growth", "rules", "audit", "hood", "connect"] as const;
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

export type ApiError = { error: string; errors?: { field: string; message: string }[] };

export type McpTokenResponse = { token: string; url: string; expiresAt: string; staffName: string };
