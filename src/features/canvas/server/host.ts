import "server-only";
import {
  createMCPClient,
  mcpAppClientCapabilities,
  readMCPAppResource,
} from "@ai-sdk/mcp";
import type { Access } from "@/features/access/server/gate";
import { APP_TOOLS, VIEW_APP_URI } from "../domain/payload";
import type { Caller } from "./caller";
import { InvalidError } from "./errors";
import { CANVAS_MCP_PATH, mcpHandler } from "./mcp";
import { shortToken } from "./mcp-token";

/*
 * The server half of the page's Host (ADR 0031). The page is an MCP Apps
 * host like Claude is: it fetches the App with `resources/read` and proxies
 * the App's `tools/call` to the MCP server. Both go through a real MCP
 * client speaking to the real handler, in process, with a short-lived token
 * for the person at the page.
 */

function hostClient(access: Access, caller: Caller, origin: string) {
  return createMCPClient({
    clientName: "canvas-host",
    capabilities: mcpAppClientCapabilities,
    transport: {
      type: "http",
      url: `${origin}${CANVAS_MCP_PATH}`,
      headers: {
        authorization: `Bearer ${shortToken(access, caller, "host")}`,
      },
      fetch: (url, init) => mcpHandler(new Request(url, init)),
    },
  });
}

/** `resources/read` of the View App: its HTML and the `_meta.ui` it asks the Host to honour. */
export async function readViewApp(
  access: Access,
  caller: Caller,
  origin: string,
) {
  const client = await hostClient(access, caller, origin);
  try {
    return await readMCPAppResource({ client, uri: VIEW_APP_URI });
  } finally {
    await client.close().catch(() => {});
  }
}

/** The tools an App may call through the Host: those whose visibility includes "app". */
const APP_CALLABLE = new Set<string>(Object.values(APP_TOOLS));

/** An App's `tools/call`, proxied to the MCP server. Returns the CallToolResult as it came. */
export async function callFromApp(
  access: Access,
  caller: Caller,
  origin: string,
  input: { name: string; arguments: Record<string, unknown> },
) {
  if (!APP_CALLABLE.has(input.name))
    throw new InvalidError(`A View may not call the tool "${input.name}".`);
  const client = await hostClient(access, caller, origin);
  try {
    return await client.callTool({
      name: input.name,
      arguments: input.arguments,
    });
  } finally {
    await client.close().catch(() => {});
  }
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
