"use client";

import { useState } from "react";
import { API } from "../domain/api";
import { mintToken } from "./api";
import { Button, Panel } from "./ui";

/** Connect a client: a per-Owner token and how to add this MCP server to Claude. */
export function ConnectPanel() {
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url =
    typeof window === "undefined"
      ? API.mcp
      : `${window.location.origin}${API.mcp}`;

  const mint = async () => {
    setPending(true);
    setError(null);
    const result = await mintToken();
    setPending(false);
    if (result.ok) setToken(result.value);
    else setError(result.error);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused: the text is on screen to select.
    }
  };

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2"
      id="cv-panel-connect"
    >
      <Panel eyebrow="One MCP server" title="Connect a client">
        <p className="text-sm leading-relaxed">
          The Analyst on this page reaches everything through one MCP server. An
          outside client gets the same tools, under your Rules, your limits and
          your Trail. A token acts for you alone and ends with your access.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="eyebrow text-[0.65rem] text-ink-muted">
              Server URL
            </dt>
            <dd className="font-mono text-xs break-all" data-testid="mcp-url">
              {url}
            </dd>
          </div>
          <div>
            <dt className="eyebrow text-[0.65rem] text-ink-muted">
              Request header
            </dt>
            <dd className="font-mono text-xs break-all">
              Authorization: Bearer {token ? token.token : "<your token>"}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            pending={pending}
            pendingLabel="Making…"
            onClick={mint}
          >
            {token ? "Make another token" : "Make a token"}
          </Button>
          {token ? (
            <Button onClick={() => void copy(token.token)}>
              {copied ? "Copied" : "Copy token"}
            </Button>
          ) : null}
        </div>
        {token ? (
          <p className="mt-2 text-xs text-ink-muted" aria-live="polite">
            Shown once. Valid until{" "}
            {new Date(token.expiresAt).toLocaleString("en-GB")}.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-seal-red">
            {error}
          </p>
        ) : null}
      </Panel>
      <Panel eyebrow="MCP Apps" title="In Claude">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            In Claude (claude.ai or the desktop app), open Settings, Connectors,
            and add a custom connector with the server URL on the left.
          </li>
          <li>
            Under its advanced settings, add the request header{" "}
            <span className="font-mono text-xs">
              Authorization: Bearer &lt;token&gt;
            </span>
            .
          </li>
          <li>
            Ask Claude a question about Meridia&apos;s data. When it calls{" "}
            <span className="font-mono text-xs">create_view</span>, Claude
            fetches the UI resource{" "}
            <span className="font-mono text-xs">ui://canvas/view.html</span> and
            shows the same View you see here, Controls included.
          </li>
        </ol>
        <p className="mt-3 text-xs text-ink-muted">
          Claude Code and other clients without MCP Apps get the same tools and
          read each View as text: its status, Claims and first rows.
        </p>
      </Panel>
    </div>
  );
}
