/** @jsxImportSource preact */
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewPayload } from "../domain/payload";
import {
  type BridgeEvent,
  createBridge,
  type HostContext,
  type Msg,
  readToolResult,
  supersedes,
  UPDATE_PARAMS_TOOL,
} from "./bridge";
import type { Theme } from "./colors";
import { type CardHost, ViewCard } from "./view-card";

/*
 * The View App's entry: one document, two modes. Inside a Host (this site's
 * page, or Claude) it speaks the MCP Apps Bridge and draws the View a tool
 * result carries. With `window.__CANVAS_STATIC__` set it draws those Views
 * as snapshots and speaks to nobody.
 */

declare global {
  interface Window {
    __CANVAS_STATIC__?: ViewPayload[];
  }
}

const HOST_VARIABLES = [
  "--color-background-primary",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-border-primary",
  "--font-sans",
  "--font-mono",
];

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Lays the Host's theme and the few variables the App takes over the document. */
function applyContext(context: HostContext): Theme {
  const root = document.documentElement;
  const theme: Theme =
    context.theme === "dark" || context.theme === "light"
      ? context.theme
      : systemTheme();
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const variables = context.styles?.variables ?? {};
  for (const name of HOST_VARIABLES) {
    const value = variables[name];
    if (
      typeof value === "string" &&
      value.length < 200 &&
      !/[;{}<]/.test(value)
    )
      root.style.setProperty(name, value);
  }
  return theme;
}

function Skeleton({ title, note }: { title: string; note: string }) {
  return (
    <div class="card skeleton" aria-busy="true">
      <p class="eyebrow">{note}</p>
      {title ? <h1 class="title">{title}</h1> : null}
      <div class="bones" aria-hidden="true">
        {[42, 64, 38, 80, 56, 92, 70, 48, 76, 60, 34, 66].map(
          (height, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration.
            <i key={index} style={{ height: `${height}%` }} />
          ),
        )}
      </div>
    </div>
  );
}

function Live() {
  const [payload, setPayload] = useState<ViewPayload | null>(null);
  const [theme, setTheme] = useState<Theme>(systemTheme());
  const [bordered, setBordered] = useState(false);
  const [canRun, setCanRun] = useState(false);
  const [building, setBuilding] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const shown = useRef<ViewPayload | null>(null);

  const bridge = useMemo(() => {
    const post = (message: Msg) => window.parent.postMessage(message, "*");
    const onEvent = (event: BridgeEvent) => {
      switch (event.type) {
        case "ready":
          setTheme(applyContext(event.context));
          setCanRun(!!event.capabilities.serverTools);
          // This site's Host asks for the Colonnade outline; Claude draws its own frame.
          setBordered(event.hostInfo.name === "canvas-host");
          break;
        case "context":
          setTheme(applyContext(event.context));
          break;
        case "input": {
          const spec = event.args.spec as { title?: unknown } | undefined;
          if (typeof spec?.title === "string") setBuilding(spec.title);
          break;
        }
        case "result": {
          const read = readToolResult(event.result);
          if (!read) break;
          if ("error" in read) {
            if (!shown.current) setProblem(read.error);
            break;
          }
          if (supersedes(shown.current?.view, read.payload.view)) {
            shown.current = read.payload;
            setProblem(null);
            setPayload(read.payload);
          }
          break;
        }
        case "cancelled":
          if (!shown.current) setProblem("The View was cancelled.");
          break;
        case "failed":
          setProblem(event.message);
          break;
        default:
          break;
      }
    };
    return createBridge(post, onEvent);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      bridge.receive(event.data);
    };
    window.addEventListener("message", onMessage);
    bridge.start();
    let last = "";
    const observer = new ResizeObserver(() => {
      const width = Math.ceil(document.documentElement.scrollWidth);
      const height = Math.ceil(document.documentElement.scrollHeight);
      const key = `${width}x${height}`;
      if (key === last) return;
      last = key;
      bridge.sizeChanged(width, height);
    });
    observer.observe(document.documentElement);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [bridge]);

  const host: CardHost = useMemo(
    () => ({
      canRun,
      run: (viewId, params) =>
        bridge.callTool(UPDATE_PARAMS_TOOL, { viewId, params }),
      tell: (text) => bridge.updateModelContext(text),
    }),
    [bridge, canRun],
  );

  return (
    <div class={bordered ? "app bordered" : "app"}>
      {payload ? (
        <ViewCard payload={payload} host={host} theme={theme} />
      ) : problem ? (
        <div class="card skeleton" role="alert">
          <p class="eyebrow">View</p>
          <p>{problem}</p>
        </div>
      ) : (
        <Skeleton
          title={building}
          note={building ? "Building View" : "Waiting for a View"}
        />
      )}
    </div>
  );
}

function Static({ payloads }: { payloads: ViewPayload[] }) {
  const theme = systemTheme();
  document.documentElement.dataset.theme = theme;
  return (
    <div class="app static">
      {payloads.map((payload) => (
        <ViewCard
          key={payload.view.id}
          payload={payload}
          host={null}
          theme={theme}
          snapshot
        />
      ))}
    </div>
  );
}

const mount = document.getElementById("app");
if (mount) {
  const snapshots = window.__CANVAS_STATIC__;
  render(
    Array.isArray(snapshots) ? <Static payloads={snapshots} /> : <Live />,
    mount,
  );
}
