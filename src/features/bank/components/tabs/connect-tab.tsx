"use client";

import { useRef, useState } from "react";
import type { McpTokenResponse } from "../../domain/api";
import { HUMAN_ONLY, MCP_COMMANDS } from "../../domain/commands";
import type { ConfirmationView } from "../../domain/views";
import { mintToken } from "../api";
import { ConfirmationCard } from "../chat/confirmation-card";
import { Button, ErrorNote, Panel } from "../ui";
import { useBank, useRead } from "../use-bank";

const TRY = [
  "List Tidewater Bank's customers and what each holds.",
  "Show Mara Voss's last ten transactions and total her card spending.",
  "Transfer MRF 40 from Mara's everyday account to her savings. (It will wait for your click here.)",
  "Which Rules would hold a payment for review, and at what amounts?",
  "Is the trial balance balanced and reconciled?",
];

function Copy({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="press font-semibold text-xs underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** Connect an outside MCP client (Claude) with a per-Owner token. */
export function ConnectTab() {
  const { tab, activeStaff, refresh } = useBank();
  const [minted, setMinted] = useState<McpTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [show, setShow] = useState(false);
  const running = useRef(false);
  const waiting = useRead<{ confirmations: ConfirmationView[] }>(
    "list_confirmations",
    {},
    { refetchMs: tab === "connect" ? 5000 : false, enabled: tab === "connect" },
  );
  const fromClients = (waiting.data?.confirmations ?? []).filter(
    (item) => item.requestedVia === "mcp" && item.status === "pending",
  );

  const mint = async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      const answer = await mintToken();
      if (answer.ok) setMinted(answer.value);
      else setError(answer.error);
    } catch {
      setError("The token could not be made. Try again.");
    } finally {
      running.current = false;
      setPending(false);
    }
  };

  const url = minted?.url ?? "<url>";
  const token = minted?.token ?? "<token>";
  const command = `claude mcp add --transport http tidewater-bank ${url} --header "Authorization: Bearer ${token}"`;
  const config = JSON.stringify(
    {
      mcpServers: {
        "tidewater-bank": {
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
    <div className="tb-scroll h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-3 sm:p-5">
        <Panel eyebrow="Connect a client" title="The bank's MCP server">
          <p className="text-sm">
            Anything the app can do, an MCP client can do: the same{" "}
            {MCP_COMMANDS.length} commands, the same Rules, the same limits.
            Sensitive writes still wait for your click here. Never a tool:{" "}
            <code>{HUMAN_ONLY.join(", ")}</code>.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              data-testid="bank-connect-mint"
              disabled={pending}
              aria-busy={pending}
              onClick={mint}
            >
              {pending
                ? "Making a token…"
                : minted
                  ? "Make a new token"
                  : "Get a token"}
            </Button>
            <span className="text-xs">
              It acts as {activeStaff.name}, the Staff member signed in now, for
              your bank only. A Guest's token dies with the Guest pass.
            </span>
          </div>
          {error ? <ErrorNote className="mt-2">{error}</ErrorNote> : null}
          {minted ? (
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="eyebrow">URL</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code data-testid="bank-connect-url" className="break-all">
                    {minted.url}
                  </code>
                  <Copy value={minted.url} label="Copy" />
                </dd>
              </div>
              <div>
                <dt className="eyebrow">
                  Token (acts as {minted.staffName}, until{" "}
                  {new Date(minted.expiresAt).toLocaleString()})
                </dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code
                    data-testid="bank-connect-token"
                    data-token={minted.token}
                    className="break-all"
                  >
                    {show
                      ? minted.token
                      : `${minted.token.slice(0, 8)}${"•".repeat(24)}`}
                  </code>
                  <button
                    type="button"
                    className="press font-semibold text-xs underline"
                    onClick={() => setShow((value) => !value)}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                  <Copy value={minted.token} label="Copy" />
                </dd>
              </div>
            </dl>
          ) : null}
        </Panel>

        <Panel
          eyebrow="Paste into Claude"
          title="Claude Code, or any MCP client"
        >
          <div className="flex flex-col gap-3 text-xs">
            <div>
              <pre className="tb-scroll-x overflow-x-auto rounded-sm border border-ink/25 bg-paper p-2">
                {show || !minted
                  ? command
                  : command.replace(minted.token, "<token>")}
              </pre>
              <Copy value={command} label="Copy the command" />
            </div>
            <div>
              <pre className="tb-scroll-x overflow-x-auto rounded-sm border border-ink/25 bg-paper p-2">
                {show || !minted
                  ? config
                  : config.replace(minted.token, "<token>")}
              </pre>
              <Copy value={config} label="Copy the config" />
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Things to try" title="From Claude">
          <ul className="list-disc pl-5 text-sm">
            {TRY.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Waiting for you"
          title="Requests from connected clients"
        >
          <div
            data-testid="bank-connect-pending"
            className="flex flex-col gap-2"
          >
            {fromClients.length === 0 ? (
              <p className="text-sm">
                Nothing is waiting. A sensitive write a client asks for appears
                here until you confirm or decline it.
              </p>
            ) : (
              fromClients.map((item) => (
                <ConfirmationCard
                  key={item.id}
                  confirmation={item}
                  onDecided={refresh}
                />
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
