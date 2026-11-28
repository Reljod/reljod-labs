"use client";

import { useEffect, useState } from "react";
import {
  GUEST_ACCESS_MCP_PATH,
  GUEST_ACCESS_SERVER_NAME,
} from "../domain/guest-access-mcp";
import { quietButtonClass } from "./styles";

/** Text to copy, shown whole so the Host sees exactly what they copy. */
function Copyable({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow">{label}</p>
      <div className="flex flex-wrap items-start gap-3">
        <pre className="outline-box min-w-0 flex-1 rounded-sm bg-marble p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
          {text}
        </pre>
        <button
          type="button"
          className={quietButtonClass}
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/**
 * The Guest access MCP server's address on the origin this page was opened
 * on, and the ways to add it: a Claude custom connector, Claude Code, or any
 * client's JSON config. Each signs in with OAuth; nothing to paste but the URL.
 */
export function McpConnect() {
  const [origin, setOrigin] = useState("https://your-site");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${GUEST_ACCESS_MCP_PATH}`;
  const config = JSON.stringify(
    { mcpServers: { [GUEST_ACCESS_SERVER_NAME]: { type: "http", url } } },
    null,
    2,
  );
  return (
    <div className="flex flex-col gap-5">
      <Copyable label="Server URL" text={url} />
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
        <li>
          <strong>Claude (web, desktop, mobile):</strong> Settings → Connectors
          → Add custom connector. Paste the URL, leave the OAuth fields empty,
          then Connect.
        </li>
        <li>
          <strong>Claude Code:</strong> run the command below, then{" "}
          <code className="font-mono">/mcp</code> and choose Authenticate.
        </li>
        <li>
          <strong>Other harnesses</strong> (anything that speaks Streamable HTTP
          with OAuth): add the URL, or the JSON below, as a remote MCP server.
        </li>
      </ol>
      <Copyable
        label="Claude Code"
        text={`claude mcp add --transport http ${GUEST_ACCESS_SERVER_NAME} ${url}`}
      />
      <Copyable label="JSON config" text={config} />
      <p className="text-sm text-ink-muted">
        Each one opens a page on this site where you allow it, signed in as a
        Host.
      </p>
    </div>
  );
}
