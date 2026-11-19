"use client";

import { useEffect, useRef, useState } from "react";
import {
  APP_TOOLS,
  isViewPayload,
  MCP_APP_PROTOCOL_VERSION,
  VIEW_PAYLOAD_KIND,
  type ViewPayload,
} from "../domain/payload";
import { appDocument, callApp } from "./api";

/*
 * The page as an MCP Apps Host (ADR 0031). Each View is the App's own HTML
 * document in a sandboxed frame (`allow-scripts` only: an opaque origin, no
 * cookies, no network), spoken to over the Bridge: JSON-RPC by postMessage,
 * the stable 2026-01-26 wire format, the same one Claude speaks to it.
 */

/** One Bridge message, for Under the hood. */
export type BridgeLog = {
  at: number;
  viewId: string;
  direction: "app → host" | "host → app";
  method: string;
  note?: string;
};

type Rpc = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

let documentOnce: Promise<string> | undefined;
/** The App document is the same for every View: fetched once per page. */
const theDocument = () => {
  documentOnce ??= appDocument().catch((error) => {
    documentOnce = undefined;
    throw error;
  });
  return documentOnce;
};

const HOST_CONTEXT = {
  theme: "light",
  displayMode: "inline",
  availableDisplayModes: ["inline"],
  platform: "web",
  styles: {
    variables: {
      "--color-background-primary": "#ffffff",
      "--color-text-primary": "#14213d",
      "--color-text-secondary": "#4a4f5b",
      "--color-border-primary": "#14213d",
    },
  },
};

export function ViewFrame({
  payload,
  onLinked,
  onLog,
}: {
  payload: ViewPayload;
  /** Views the server ran again because they share a changed Parameter. */
  onLinked: (payloads: ViewPayload[]) => void;
  onLog: (entry: BridgeLog) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [height, setHeight] = useState(420);
  const ready = useRef(false);
  const latest = useRef(payload);
  const sent = useRef<string>("");
  const callbacks = useRef({ onLinked, onLog });
  callbacks.current = { onLinked, onLog };
  const viewId = payload.view.id;

  useEffect(() => {
    let live = true;
    theDocument().then(
      (text) => live && setHtml(text),
      (error: Error) => live && setFailed(error.message),
    );
    return () => {
      live = false;
    };
  }, []);

  const post = (message: Rpc, note?: string) => {
    frame.current?.contentWindow?.postMessage(message, "*");
    callbacks.current.onLog({
      at: Date.now(),
      viewId,
      direction: "host → app",
      method: message.method ?? (message.error ? "error" : "result"),
      note,
    });
  };

  const sendResult = (next: ViewPayload) => {
    const key = `${next.view.id}:${next.view.revision}`;
    if (sent.current === key) return;
    sent.current = key;
    post(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          content: [{ type: "text", text: next.view.spec.title }],
          structuredContent: next,
        },
      },
      `revision ${next.view.revision}`,
    );
  };

  // A newer revision from outside (a Linked View, a revised View) goes to the App.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sendResult reads refs only.
  useEffect(() => {
    latest.current = payload;
    if (ready.current) sendResult(payload);
  }, [payload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the listener reads refs; it is bound once per document.
  useEffect(() => {
    if (!html) return;
    const onMessage = async (event: MessageEvent) => {
      // Only this View's own frame is listened to.
      if (!frame.current || event.source !== frame.current.contentWindow)
        return;
      const message = event.data as Rpc;
      if (!message || message.jsonrpc !== "2.0" || !message.method) return;
      const log = (note?: string) =>
        callbacks.current.onLog({
          at: Date.now(),
          viewId,
          direction: "app → host",
          method: message.method as string,
          note,
        });
      const reply = (result: unknown, note?: string) =>
        post({ jsonrpc: "2.0", id: message.id, result }, note);
      switch (message.method) {
        case "ui/initialize":
          log();
          reply({
            protocolVersion: MCP_APP_PROTOCOL_VERSION,
            hostInfo: { name: "canvas-host", version: "1.0.0" },
            hostCapabilities: {
              serverTools: {},
              updateModelContext: { text: {} },
            },
            hostContext: HOST_CONTEXT,
          });
          return;
        case "ui/notifications/initialized":
          log();
          ready.current = true;
          post({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-input",
            params: { arguments: { viewId } },
          });
          sendResult(latest.current);
          return;
        case "ui/notifications/size-changed": {
          const next = Number(message.params?.height);
          if (Number.isFinite(next) && next > 0)
            setHeight(Math.min(Math.ceil(next), 2400));
          return;
        }
        case "tools/call": {
          const name = String(message.params?.name ?? "");
          const args = (message.params?.arguments ?? {}) as Record<
            string,
            unknown
          >;
          log(`${name} ${JSON.stringify(args.params ?? {})}`.slice(0, 160));
          if (!(Object.values(APP_TOOLS) as string[]).includes(name)) {
            post({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32602,
                message: `A View may not call "${name}".`,
              },
            });
            return;
          }
          // A failed fetch (offline, aborted) must still answer the App's request.
          const result = await callApp({ name, arguments: args }).catch(
            (error: Error) => ({
              isError: true,
              content: [{ type: "text", text: error.message }],
              structuredContent: undefined,
            }),
          );
          const structured = result.structuredContent;
          if (isViewPayload(structured)) {
            sent.current = `${structured.view.id}:${structured.view.revision}`;
            const { linked, ...own } = structured;
            callbacks.current.onLinked([
              own,
              ...(linked ?? []).map((view) => ({
                kind: VIEW_PAYLOAD_KIND,
                view,
              })),
            ] as ViewPayload[]);
          }
          reply(
            result,
            result.isError
              ? "refused"
              : isViewPayload(structured)
                ? `${structured.view.result.rowCount} rows, no model call`
                : undefined,
          );
          return;
        }
        case "ui/update-model-context":
          log(
            String(
              (message.params?.content as { text?: string }[] | undefined)?.[0]
                ?.text ?? "",
            ).slice(0, 160),
          );
          reply({});
          return;
        case "ping":
          reply({});
          return;
        default:
          if (message.id !== undefined)
            post({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32601,
                message: `Method not found: ${message.method}`,
              },
            });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html, viewId]);

  if (failed)
    return (
      <p role="alert" className="p-4 text-sm text-seal-red">
        The View could not be shown: {failed}
      </p>
    );
  if (!html)
    return (
      <div className="h-[420px] animate-pulse bg-marble" aria-hidden="true" />
    );
  return (
    <iframe
      ref={frame}
      title={payload.view.spec.title}
      data-testid="view-frame"
      data-view-id={viewId}
      data-revision={payload.view.revision}
      sandbox="allow-scripts"
      srcDoc={html}
      className="block w-full border-0 bg-paper"
      style={{ height }}
    />
  );
}
