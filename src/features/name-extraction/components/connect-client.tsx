"use client";

import { useState } from "react";
import { mintMcpToken } from "../server/actions";
import { Button, ErrorNote, useWrite } from "./ui";

type Minted = { token: string; expiresAt: string };

/**
 * "Connect a client": mints a bearer token for an outside MCP client (Claude
 * Code, say) that acts for this Owner on the Sieve MCP endpoint. The token is
 * shown once, here, and is not stored on the server.
 */
export function ConnectClient({ endpoint }: { endpoint: string }) {
  const [minted, setMinted] = useState<Minted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const mint = useWrite(async () => {
    setError(null);
    setCopied(null);
    try {
      setMinted(await mintMcpToken());
    } catch {
      setError("The token could not be made. Try again.");
    }
  });
  const command = minted
    ? `claude mcp add --transport http sieve ${endpoint} --header "Authorization: Bearer ${minted.token}"`
    : "";
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied(null);
      setError("Copy failed: select the text and copy it by hand.");
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          pending={mint.pending}
          pendingLabel="Making a token…"
          onClick={() => void mint.run()}
        >
          {minted ? "Make another token" : "Connect a client"}
        </Button>
        <span className="text-xs text-ink-muted">
          A bearer token that acts for you; a Guest&apos;s ends with the pass.
        </span>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {minted ? (
        <output className="flex flex-col gap-2 rounded-sm border border-ink/15 bg-marble/40 p-2 text-xs">
          <span className="block">
            Shown once. Works until{" "}
            {new Date(minted.expiresAt).toLocaleString()}.
          </span>
          <code className="block font-mono [overflow-wrap:anywhere]">
            {minted.token}
          </code>
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy("token", minted.token)}
            >
              {copied === "token" ? "Token copied" : "Copy token"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy("command", command)}
            >
              {copied === "command"
                ? "Command copied"
                : "Copy Claude Code command"}
            </Button>
          </span>
        </output>
      ) : null}
    </div>
  );
}
