import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { type CommandDef, MCP_COMMANDS } from "../domain/commands";
import { LIMITS } from "../domain/limits";
import { read, write } from "./bank";
import { type Caller, callerOf, verifyBearer } from "./mcp-auth";
import { refusalOf } from "./respond";

/*
 * The Tidewater Bank MCP server: the only way the Teller reaches the bank,
 * and the way outside clients (Claude) do. One tool per command, registered
 * from the same list the app uses (domain/commands.ts) and calling the same
 * two doors (server/bank.ts). No tool gives an Approval or confirms a
 * request: those commands are not in MCP_COMMANDS.
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
        try {
          if (def.kind === "read")
            return result(await read(caller.actor, def.name, args));
          const { idempotencyKey, ...input } = args;
          return result(
            await write(
              caller.actor,
              caller.visitor,
              def.name,
              input,
              typeof idempotencyKey === "string" ? idempotencyKey : null,
            ),
          );
        } catch (error) {
          const known = refusalOf(error);
          if (known) return refusal(`Refused: ${known.message}`);
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
    const caller = claims ? await callerOf(claims) : null;
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
