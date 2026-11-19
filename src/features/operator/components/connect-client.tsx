"use client";

import { useEffect, useState } from "react";
import { apiPath } from "../domain/api";
import { LIMITS } from "../domain/limits";
import { MCP_TOOLS, type McpToolInfo } from "../domain/mcp-tools";
import { mintMcpToken } from "../server/actions";
import { Button, ErrorNote, Panel, Tag, useWrite } from "./ui";

type Minted = { token: string; expiresAt: string };

const GROUPS: { id: McpToolInfo["group"]; title: string }[] = [
  { id: "runs", title: "Runs" },
  { id: "screen", title: "Screen" },
  { id: "work", title: "Work" },
  { id: "rules", title: "Rules" },
];

const PLACEHOLDER = "<token>";

function Copyable({
  label,
  text,
  enabled,
}: {
  label: string;
  text: string;
  enabled: boolean;
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow text-[0.62rem] text-ink-muted">{label}</span>
        <Button size="sm" disabled={!enabled} onClick={() => void copy()}>
          {copied === "yes" ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-sm border-2 border-ink/15 bg-marble p-2 font-mono text-[0.7rem] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {text}
      </pre>
      {copied === "failed" ? (
        <ErrorNote>Copy failed: select the text and copy it by hand.</ErrorNote>
      ) : null}
    </div>
  );
}

/**
 * "Connect a client": the MCP server's address, a bearer token minted for
 * this Owner (shown once), ready-to-paste config, and every tool the server
 * has, marking the ones the in-app Operator itself uses.
 */
export function ConnectClient() {
  // Read after mount, so the server and the first client render agree.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${apiPath.mcp()}`;

  const [minted, setMinted] = useState<Minted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mint = useWrite(async () => {
    setError(null);
    try {
      const fresh = await mintMcpToken();
      if (!fresh.token) {
        setError("Tokens are not available on this server yet.");
        return;
      }
      setMinted(fresh);
    } catch {
      setError("The token could not be made. Try again.");
    }
  });

  const token = minted?.token ?? PLACEHOLDER;
  const command = `claude mcp add --transport http operator ${url} --header "Authorization: Bearer ${token}"`;
  const json = JSON.stringify(
    {
      mcpServers: {
        operator: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel
        eyebrow="Connect a client"
        title="Drive the same Screen from Claude"
        bodyClassName="flex flex-col gap-4 p-4"
      >
        <p className="text-sm leading-relaxed">
          An outside MCP client drives the same Screen through the same Guard:
          it calls <code className="font-mono">start_run</code> with{" "}
          <code className="font-mono">driver: &quot;client&quot;</code>, then
          the <code className="font-mono">screen_*</code> tools, and every key
          meets the same Rules. It cannot approve its own keys:{" "}
          <code className="font-mono">decide_approval</code> is refused for a
          Run the client drives itself, so a person on this page decides.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-[0.62rem] text-ink-muted">
            Server URL
          </span>
          <code className="block rounded-sm border-2 border-ink/15 bg-marble px-2 py-1.5 font-mono text-xs [overflow-wrap:anywhere]">
            {url}
          </code>
        </div>

        <div className="flex flex-col gap-2 rounded-sm border-2 border-brass bg-brass/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              pending={mint.pending}
              pendingLabel="Minting…"
              onClick={() => void mint.run()}
            >
              {minted ? "Mint another token" : "Mint a token"}
            </Button>
          </div>
          <p className="text-xs leading-relaxed">
            The token acts as you. Whatever a client does with it lands in your
            Trail and counts against your caps: {LIMITS.runsPerOwnerPerDay} Runs
            a day and ${LIMITS.usdPerRun.toFixed(2)} of model spend a Run. A
            Guest&apos;s token ends with the pass.
          </p>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {minted ? (
            <output className="flex flex-col gap-2 text-xs">
              <span>
                Shown once. It works until{" "}
                <strong>{new Date(minted.expiresAt).toLocaleString()}</strong>.
              </span>
              <Copyable label="Token" text={minted.token} enabled />
            </output>
          ) : null}
        </div>

        <Copyable
          label="Claude Code"
          text={command}
          enabled={minted !== null && origin !== ""}
        />
        <Copyable
          label="JSON config"
          text={json}
          enabled={minted !== null && origin !== ""}
        />
        {minted ? null : (
          <p className="text-xs text-ink-muted">
            Mint a token first; it takes the place of {PLACEHOLDER}.
          </p>
        )}
      </Panel>

      <Panel
        eyebrow={`${MCP_TOOLS.length} tools`}
        title="What the server offers"
        bodyClassName="flex flex-col gap-4 p-4"
      >
        <p className="text-xs text-ink-muted">
          <Tag tone="ink">Operator</Tag> marks a tool the in-app Operator uses
          too: one guarded path for both.
        </p>
        {GROUPS.map((group) => (
          <section key={group.id} className="flex flex-col gap-1.5">
            <h3 className="eyebrow text-[0.65rem] font-bold">{group.title}</h3>
            <ul className="flex flex-col divide-y divide-ink/10 rounded-sm border-2 border-ink/15">
              {MCP_TOOLS.filter((tool) => tool.group === group.id).map(
                (tool) => (
                  <li
                    key={tool.name}
                    className="flex flex-col gap-0.5 px-3 py-2"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-xs font-bold">
                        {tool.name}
                      </code>
                      <span className="text-xs">{tool.title}</span>
                      {tool.operator ? (
                        <span className="ml-auto">
                          <Tag tone="ink">Operator</Tag>
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {tool.summary}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </Panel>
    </div>
  );
}
