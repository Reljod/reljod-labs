import "server-only";
import type { Access } from "@/features/access/server/gate";
import { InvalidError } from "@/platform/errors";
import { APP_TOOLS } from "../../domain/payload";
import type { Caller, McpClient, McpConnector } from "../ports";
import type { ConnectService } from "./connect";

/*
 * The server half of the page's Host (ADR 0031). The page is an MCP Apps
 * host like Claude is: it fetches the App with `resources/read` and proxies
 * the App's `tools/call` to the MCP server. Both go through a real MCP
 * client speaking to the real handler, in process, with a short-lived token
 * for the person at the page.
 */

/** The tools an App may call through the Host: those whose visibility includes "app". */
const APP_CALLABLE = new Set<string>(Object.values(APP_TOOLS));

/** A CallToolResult as the MCP server gave it. */
export type ToolCallResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

export interface HostService {
  /**
   * The document the page's sandboxed frame loads: the View App, with the
   * Content-Security-Policy its resource declared, as a header value and
   * inside the document (it goes in `srcdoc`, where a header does not reach).
   */
  frame(
    access: Access,
    caller: Caller,
    origin: string,
  ): Promise<{ html: string; csp: string }>;
  /** An App's `tools/call`, proxied to the MCP server, for the App's tools only. */
  call(
    access: Access,
    caller: Caller,
    origin: string,
    input: { name: string; arguments: Record<string, unknown> },
  ): Promise<ToolCallResult>;
}

const HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i;

/** Origins a resource asked for, kept only when they are plain https hosts. */
const origins = (values: unknown) =>
  (Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/^https:\/\//, ""))
    .filter((value) => HOST.test(value))
    .slice(0, 8)
    .map((value) => `https://${value}`);

/**
 * The Content-Security-Policy the App's document is served under, built from
 * what its resource declared (`_meta.ui.csp`) and nothing more. Undeclared
 * means none: no network, no frames, no forms.
 */
export function appCsp(csp: Record<string, unknown> | undefined) {
  const connect = origins(csp?.connectDomains);
  const resource = origins(csp?.resourceDomains);
  const frame = origins(csp?.frameDomains);
  const list = (items: string[]) =>
    items.length > 0 ? ` ${items.join(" ")}` : "";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${list(resource)}`,
    `style-src 'unsafe-inline'${list(resource)}`,
    `img-src data:${list(resource)}`,
    `font-src data:${list(resource)}`,
    `connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
    `frame-src ${frame.length > 0 ? frame.join(" ") : "'none'"}`,
    "form-action 'none'",
    "base-uri 'none'",
    // Even opened directly, the document runs in an opaque origin.
    "sandbox allow-scripts",
  ].join("; ");
}

export function createHostService(ports: {
  connect: Pick<ConnectService, "shortToken">;
  mcp: McpConnector;
}): HostService {
  async function withClient<T>(
    access: Access,
    caller: Caller,
    origin: string,
    work: (client: McpClient) => Promise<T>,
  ) {
    const client = await ports.mcp({
      token: ports.connect.shortToken(access, caller, "host"),
      origin,
      clientName: "canvas-host",
    });
    try {
      return await work(client);
    } finally {
      await client.close().catch(() => {});
    }
  }

  return {
    async frame(access, caller, origin) {
      const app = await withClient(access, caller, origin, (client) =>
        client.readApp(),
      );
      const csp = appCsp(app.meta?.csp as Record<string, unknown> | undefined);
      const html = app.html.replace(
        "<head>",
        `<head><meta http-equiv="Content-Security-Policy" content="${csp.replace("; sandbox allow-scripts", "")}">`,
      );
      return { html, csp };
    },

    async call(access, caller, origin, input) {
      if (!APP_CALLABLE.has(input.name))
        throw new InvalidError(`A View may not call the tool "${input.name}".`);
      return withClient(
        access,
        caller,
        origin,
        (client) =>
          client.callTool({
            name: input.name,
            arguments: input.arguments,
          }) as Promise<ToolCallResult>,
      );
    },
  };
}
