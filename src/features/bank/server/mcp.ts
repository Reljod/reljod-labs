import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { ZodError, z } from "zod";
import { isAppError } from "@/platform/errors";
import { type CommandDef, MCP_COMMANDS } from "../domain/commands";
import { LIMITS } from "../domain/limits";
import { bank } from "./container";
import { verifyBearer } from "./mcp-auth";
import type { Caller } from "./ports";

/*
 * The Tidewater Bank MCP server: the only way the Teller reaches the bank,
 * and the way outside clients (Claude) do. One tool per command, registered
 * from the same list the app uses (domain/commands.ts) and calling the same
 * command service the app's routes call (services/commands.ts). No tool
 * gives an Approval or confirms a request: those commands are not in
 * MCP_COMMANDS. Bearer-authenticated: no cookie, no same-origin check.
 */

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

function callerFrom(ctx: unknown): Caller {
  const caller = (ctx as ToolContext).http?.authInfo?.extra?.caller as
    | Caller
    | undefined;
  if (!caller) throw new Error("Not authorised");
  return caller;
}

function cut(text: string): string {
  return text.length > LIMITS.toolOutputChars
    ? `${text.slice(0, LIMITS.toolOutputChars)}\n… [cut: ask for less, or page with limit/beforeId]`
    : text;
}

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: cut(JSON.stringify(data)) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/** The words of a refusal a person may read, or null for anything else. */
function refusalOf(error: unknown): string | null {
  if (isAppError(error)) return error.message;
  if (error instanceof ZodError)
    return error.issues[0]?.message ?? "That input doesn't look right.";
  return null;
}

function refusal(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** A tool's input: the command's own fields, plus an idempotency key on a write. */
function toolSchema(def: CommandDef) {
  const shape = (def.input as unknown as z.ZodObject).shape;
  return def.kind === "read"
    ? z.object(shape)
    : z.object({
        ...shape,
        idempotencyKey: z
          .string()
          .min(8)
          .max(120)
          .optional()
          .describe(
            "Optional. Send the same key to retry safely: the command runs once.",
          ),
      });
}

export function registerBankTools(server: McpServer) {
  for (const def of MCP_COMMANDS as readonly CommandDef[]) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: `${def.description}${def.kind === "write" && def.sensitive ? " Sensitive: it is not done until the person confirms it in the app." : ""}`,
        inputSchema: toolSchema(def),
        annotations: { readOnlyHint: def.kind === "read" },
      },
      async (args: Record<string, unknown>, ctx: unknown) => {
        const caller = callerFrom(ctx);
        // MCP tools reach no paid adapter, so they always use the live services.
        const { commands } = bank();
        try {
          if (def.kind === "read")
            return result(await commands.read(caller.actor, def.name, args));
          const { idempotencyKey, ...input } = args;
          return result(
            await commands.write(
              caller,
              def.name,
              input,
              typeof idempotencyKey === "string" ? idempotencyKey : null,
            ),
          );
        } catch (error) {
          const known = refusalOf(error);
          if (known) return refusal(`Refused: ${known}`);
          console.error("[bank] mcp", def.name, error);
          return refusal("The bank could not do that right now.");
        }
      },
    );
  }
}

const handler = createMcpHandler(registerBankTools, {
  serverInfo: { name: "tidewater-bank", version: "1.0.0" },
});

/**
 * The MCP route's handler. The only bearer is a token minted for an Owner
 * and a Staff member ("Connect a client", or the Teller's own per turn),
 * checked against the Owner's Access on every call.
 */
export const mcpHandler = withMcpAuth(
  handler,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const claims = await verifyBearer(bearer);
    const caller = claims ? await bank().staff.caller(claims) : null;
    if (!claims || !caller) return undefined;
    return {
      token: bearer,
      clientId: `tidewater-${claims.kind}-${claims.via}`,
      scopes: ["bank"],
      extra: { caller },
    };
  },
  { required: true },
);
