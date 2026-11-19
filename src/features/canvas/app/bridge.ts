import type { ViewPayload, ViewRecord } from "../domain/payload";
import type { ParamValues } from "../domain/view";
import { formatValue } from "./format";

/**
 * The App's side of the Bridge (MCP Apps, stable wire format 2026-01-26),
 * hand-rolled. Everything here is pure: it is given a `post` to send with and
 * handed each message that arrives, so it runs under test without a window.
 */

export const PROTOCOL_VERSION = "2026-01-26";
export const APP_NAME = "canvas-view";
export const APP_VERSION = "1.0.0";
export const UPDATE_PARAMS_TOOL = "update_view_params";
/** How long a Control waits for the next change before it runs the Query. */
export const DEBOUNCE_MS = 220;

export type RpcId = number | string;
export type Msg = {
  jsonrpc: "2.0";
  id?: RpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type HostContext = {
  theme?: "light" | "dark";
  styles?: {
    variables?: Record<string, string | undefined>;
    css?: { fonts?: string };
  };
  [key: string]: unknown;
};

export type HostCapabilities = {
  serverTools?: object;
  updateModelContext?: object;
  [key: string]: unknown;
};

/** A CallToolResult, as far as the App reads one. */
export type ToolResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type BridgeEvent =
  | {
      type: "ready";
      hostInfo: { name?: string; version?: string };
      capabilities: HostCapabilities;
      context: HostContext;
    }
  /** `changed` is what just arrived; `context` is everything merged. */
  | { type: "context"; changed: HostContext; context: HostContext }
  | { type: "input"; args: Record<string, unknown>; partial: boolean }
  | { type: "result"; result: ToolResult }
  | { type: "cancelled"; reason: string }
  | { type: "teardown" }
  | { type: "failed"; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function createBridge(
  post: (message: Msg) => void,
  emit: (event: BridgeEvent) => void,
) {
  let nextId = 1;
  const pending = new Map<
    RpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let context: HostContext = {};
  let capabilities: HostCapabilities = {};
  let ready = false;

  const request = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      post({ jsonrpc: "2.0", id, method, params });
    });

  const notify = (method: string, params?: unknown) =>
    post(
      params === undefined
        ? { jsonrpc: "2.0", method }
        : { jsonrpc: "2.0", method, params },
    );

  const merge = (changed: HostContext) => {
    context = {
      ...context,
      ...changed,
      ...(changed.styles
        ? {
            styles: {
              ...context.styles,
              ...changed.styles,
              variables: {
                ...context.styles?.variables,
                ...changed.styles.variables,
              },
            },
          }
        : {}),
    };
  };

  const notifications: Record<string, (params: Record<string, unknown>) => void> =
    {
      "ui/notifications/tool-input-partial": (params) =>
        emit({
          type: "input",
          args: isObject(params.arguments) ? params.arguments : {},
          partial: true,
        }),
      "ui/notifications/tool-input": (params) =>
        emit({
          type: "input",
          args: isObject(params.arguments) ? params.arguments : {},
          partial: false,
        }),
      "ui/notifications/tool-result": (params) =>
        emit({ type: "result", result: params as ToolResult }),
      "ui/notifications/tool-cancelled": (params) =>
        emit({
          type: "cancelled",
          reason:
            typeof params.reason === "string" ? params.reason : "cancelled",
        }),
      "ui/notifications/host-context-changed": (params) => {
        merge(params as HostContext);
        emit({ type: "context", changed: params as HostContext, context });
      },
    };

  return {
    /** Sends `ui/initialize`; on the answer, `ui/notifications/initialized`. */
    start() {
      request("ui/initialize", {
        appInfo: { name: APP_NAME, version: APP_VERSION },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: PROTOCOL_VERSION,
      }).then(
        (result) => {
          const init = isObject(result) ? result : {};
          capabilities = isObject(init.hostCapabilities)
            ? (init.hostCapabilities as HostCapabilities)
            : {};
          merge(isObject(init.hostContext) ? (init.hostContext as HostContext) : {});
          ready = true;
          emit({
            type: "ready",
            hostInfo: isObject(init.hostInfo) ? init.hostInfo : {},
            capabilities,
            context,
          });
          notify("ui/notifications/initialized");
        },
        (error: Error) => emit({ type: "failed", message: error.message }),
      );
    },

    /** One message from the Host. The caller has already checked `event.source`. */
    receive(data: unknown) {
      if (!isObject(data) || data.jsonrpc !== "2.0") return;
      const message = data as Msg;
      if (message.method === undefined) {
        if (message.id === undefined) return;
        const waiting = pending.get(message.id);
        if (!waiting) return;
        pending.delete(message.id);
        if (message.error)
          waiting.reject(
            Object.assign(new Error(message.error.message), {
              code: message.error.code,
            }),
          );
        else waiting.resolve(message.result);
        return;
      }
      if (message.id !== undefined) {
        if (message.method === "ui/resource-teardown") {
          emit({ type: "teardown" });
          post({ jsonrpc: "2.0", id: message.id, result: {} });
        } else if (message.method === "ping")
          post({ jsonrpc: "2.0", id: message.id, result: {} });
        else
          post({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: `Method not found: ${message.method}`,
            },
          });
        return;
      }
      notifications[message.method]?.(
        isObject(message.params) ? message.params : {},
      );
    },

    request,
    notify,
    isReady: () => ready,
    context: () => context,
    capabilities: () => capabilities,
    canCallTools: () => !!capabilities.serverTools,
    canUpdateModelContext: () => !!capabilities.updateModelContext,

    /** `tools/call`, proxied by the Host to the MCP server. */
    callTool(name: string, args: Record<string, unknown>) {
      if (!capabilities.serverTools)
        return Promise.reject(new Error("This Host cannot run Queries from a View."));
      return request("tools/call", { name, arguments: args }) as Promise<ToolResult>;
    },

    updateModelContext(text: string) {
      if (!capabilities.updateModelContext) return;
      request("ui/update-model-context", {
        content: [{ type: "text", text }],
      }).catch(() => {});
    },

    sizeChanged(width: number, height: number) {
      notify("ui/notifications/size-changed", { width, height });
    },
  };
}

export type Bridge = ReturnType<typeof createBridge>;

/** The App's own `isViewPayload` (the domain's is a value import). */
export function asViewPayload(value: unknown): ViewPayload | null {
  if (!isObject(value) || value.kind !== "canvas.view") return null;
  const view = value.view;
  if (!isObject(view) || !isObject(view.spec) || !isObject(view.result))
    return null;
  return value as ViewPayload;
}

/** What a CallToolResult holds for the App: a View, an error in words, or nothing it draws. */
export function readToolResult(
  result: ToolResult | null | undefined,
): { payload: ViewPayload } | { error: string } | null {
  if (!result) return null;
  if (result.isError) {
    const text = result.content?.find((item) => item.type === "text")?.text;
    return { error: text?.trim() || "The Query could not be run." };
  }
  const payload = asViewPayload(result.structuredContent);
  return payload ? { payload } : null;
}

/**
 * Whether an arriving View replaces the one on screen: a different View
 * always does, the same View only at the same or a later revision.
 */
export function supersedes(
  shown: Pick<ViewRecord, "id" | "revision"> | null | undefined,
  incoming: Pick<ViewRecord, "id" | "revision">,
) {
  if (!shown || shown.id !== incoming.id) return true;
  return incoming.revision >= shown.revision;
}

/**
 * Numbers the Parameter changes so a newer change supersedes an older
 * answer: only the answer to the latest call is applied.
 */
export function createSequence() {
  let latest = 0;
  return {
    next: () => ++latest,
    isLatest: (sequence: number) => sequence === latest,
  };
}

/** What the model is told after a Parameter change: the View, its values and its Claims as recomputed. */
export function modelContextText(view: ViewRecord, params: ParamValues) {
  const values = Object.entries(params)
    .map(([name, value]) => `${name} = ${value}`)
    .join(", ");
  const claims = view.verification.claims.map(
    (claim) =>
      `${claim.label}: ${
        claim.actual === null
          ? "could not be computed"
          : formatValue(claim.actual, { format: claim.format, unit: claim.unit })
      }`,
  );
  return [
    `The person is looking at the View "${view.spec.title}" (${view.id}, ${view.status}).`,
    values ? `Parameters now: ${values}.` : "",
    claims.length ? `Claims recomputed: ${claims.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
