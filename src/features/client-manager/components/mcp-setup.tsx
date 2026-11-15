"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MCP_SERVER_NAME, MCP_TOOLS, researchSkill } from "../domain/research";
import { Icon } from "./icons";

type Minted = {
  token: string;
  kind: "host" | "guest" | "e2e";
  expiresAt: string;
};

/**
 * How to use the Client Manager from Claude Code: one command with this
 * visitor's token in its header, the tools it gets, and the research skill.
 */
export function McpSetup() {
  const [origin, setOrigin] = useState("https://your-site");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  // Set at once, so a double click cannot mint two tokens.
  const minting = useRef(false);
  const mint = async () => {
    if (minting.current) return;
    minting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/client-manager/mcp-token", {
        method: "POST",
      });
      const body = (await response.json()) as Minted & { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Could not create a token.");
      setMinted(body);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not create a token.",
      );
    } finally {
      minting.current = false;
      setBusy(false);
    }
  };

  const url = `${origin}/api/client-manager/mcp`;
  const token = minted?.token ?? "<token>";
  const visible =
    shown || !minted ? token : `${token.slice(0, 10)}…${token.slice(-6)}`;
  const command = (value: string) =>
    `claude mcp add --transport http ${MCP_SERVER_NAME} ${url} \\\n  --header "Authorization: Bearer ${value}"`;
  const json = (value: string) =>
    JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: "http",
            url,
            headers: { Authorization: `Bearer ${value}` },
          },
        },
      },
      null,
      2,
    );
  const guest = minted?.kind === "guest";

  const downloadSkill = () => {
    const blob = new Blob([researchSkill()], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "SKILL.md";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="min-h-dvh bg-marble text-ink">
      <header className="flex items-center gap-2 border-ink/10 border-b bg-paper px-4 py-2.5">
        <Link
          href="/demos/client-manager"
          className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <Icon name="back" className="size-4" />
          Client Manager
        </Link>
      </header>
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6">
        <section className="space-y-3">
          <p className="flex items-center gap-2 font-mono text-xs font-bold tracking-[0.08em] text-federal-blue uppercase">
            <Icon name="plug" className="size-4" /> MCP
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your client book, inside Claude Code
          </h1>
          <p className="max-w-xl text-ink-muted">
            The same server the desk uses: every client's graph, the documents
            behind each fact, and how sure it is.
          </p>
        </section>

        <Step n={1} title="Get your token">
          {minted ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-bold uppercase ${guest ? "bg-brass/30" : "bg-ivy/15 text-ivy"}`}
              >
                {guest
                  ? "Guest token"
                  : minted.kind === "host"
                    ? "Host token"
                    : "Test token"}
              </span>
              <span className="text-ink-muted">
                until{" "}
                {new Date(minted.expiresAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              {guest ? (
                <span className="text-ink-muted">
                  · ends with your guest pass
                </span>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void mint()}
              disabled={busy}
              aria-busy={busy}
              className="flex items-center gap-2 rounded-sm bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-federal-blue disabled:opacity-50"
            >
              <Icon name="spark" className="size-4" />
              {busy ? "Creating…" : "Create my token"}
            </button>
          )}
          {error ? <p className="text-sm text-seal-red">{error}</p> : null}
        </Step>

        <Step n={2} title="Add the server">
          <Code
            text={command(visible)}
            copy={minted ? command(token) : null}
            onReveal={minted ? () => setShown(!shown) : undefined}
            revealed={shown}
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">
              .mcp.json
            </summary>
            <div className="mt-2">
              <Code text={json(visible)} copy={minted ? json(token) : null} />
            </div>
          </details>
          <p className="flex items-start gap-2 text-sm text-ink-muted">
            <Icon name="spark" className="mt-0.5 size-4 text-brass" />
            <span>
              The <code className="font-mono text-ink">Authorization</code>{" "}
              header is required.
              {guest
                ? " As a guest, it carries your guest token: keep it to yourself."
                : " Keep it to yourself."}
            </span>
          </p>
        </Step>

        <Step n={3} title="Add the research skill">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={downloadSkill}
              className="flex items-center gap-2 rounded-sm border border-ink/20 bg-paper px-3 py-2 text-sm font-medium hover:border-federal-blue hover:text-federal-blue"
            >
              <Icon name="download" className="size-4" />
              SKILL.md
            </button>
            <span className="text-sm text-ink-muted">
              into{" "}
              <code className="font-mono text-ink">
                ~/.claude/skills/client-research/
              </code>
            </span>
          </div>
          <Code
            text={`"Research Elena Marsh and add what's new"`}
            copy={null}
            quiet
          />
          <p className="text-sm text-ink-muted">
            Or run the server's prompt:{" "}
            <code className="font-mono text-ink">
              /mcp__{MCP_SERVER_NAME}__research_client
            </code>
          </p>
        </Step>

        <section aria-label="Tools" className="space-y-3">
          <h2 className="font-mono text-xs font-bold tracking-[0.08em] text-stone uppercase">
            Tools
          </h2>
          <ul className="grid gap-px overflow-hidden rounded-sm border border-ink/10 bg-ink/10 sm:grid-cols-2">
            {MCP_TOOLS.map((tool, index) => (
              <motion.li
                key={tool.name}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.03 }}
                className="flex items-center gap-3 bg-paper px-3 py-2"
              >
                <code className="font-mono text-[0.8rem] font-bold">
                  {tool.name}
                </code>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                  {tool.does}
                </span>
                {tool.writes ? (
                  <span
                    title="Writes"
                    className="rounded-sm bg-brass/30 px-1 font-mono text-[0.6rem] font-bold uppercase"
                  >
                    write
                  </span>
                ) : null}
              </motion.li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-3">
      <span className="flex size-7 items-center justify-center rounded-full bg-ink font-mono text-sm font-bold text-paper">
        {n}
      </span>
      <h2 className="self-center text-lg font-semibold">{title}</h2>
      <div className="col-start-2 space-y-3">{children}</div>
    </section>
  );
}

function Code({
  text,
  copy,
  onReveal,
  revealed,
  quiet = false,
}: {
  text: string;
  copy: string | null;
  onReveal?: () => void;
  revealed?: boolean;
  quiet?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={`relative rounded-sm ${quiet ? "bg-paper text-ink" : "bg-ink text-morning-haze"}`}
    >
      <pre
        className={`cm-scroll overflow-x-auto p-4 font-mono ${copy || onReveal ? "pt-9" : ""} text-[0.8rem] leading-relaxed whitespace-pre`}
      >
        {text}
      </pre>
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        {onReveal ? (
          <button
            type="button"
            onClick={onReveal}
            className="rounded-sm px-2 py-1 font-mono text-[0.65rem] text-paper/70 hover:bg-paper/10 hover:text-paper"
          >
            {revealed ? "hide" : "show"}
          </button>
        ) : null}
        {copy ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(copy).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            aria-label="Copy"
            className="flex items-center gap-1 rounded-sm bg-paper/10 px-2 py-1 font-mono text-[0.65rem] text-paper hover:bg-paper/20"
          >
            <Icon name={copied ? "check" : "copy"} className="size-3" />
            {copied ? "copied" : "copy"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
