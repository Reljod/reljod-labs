"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DemoBar } from "@/components/demo/demo-bar";
import type { McpTokenResponse } from "../domain/api";
import { GUEST_TOKEN_HEADER, MCP_PATH } from "../domain/oauth-paths";
import { MCP_SERVER_NAME, MCP_TOOLS, researchSkill } from "../domain/research";
import { mintMcpToken } from "./api";
import { Icon } from "./icons";

type Minted = McpTokenResponse;

/**
 * How to use the Client Manager from Claude Code: one command with the
 * server's URL, an OAuth sign-in in the browser, the tools it gets, and the
 * research skill. A Guest also sends their guest token in a header, which
 * ties the OAuth sign-in to their Guest pass. A pasted token remains for
 * clients without OAuth.
 */
export function McpSetup({ guest }: { guest: boolean }) {
  const [origin, setOrigin] = useState("https://your-site");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  // Set at once, so a double click cannot mint two tokens.
  const minting = useRef(false);
  const mint = async () => {
    if (minting.current) return;
    minting.current = true;
    setBusy(true);
    setError(null);
    try {
      setMinted(await mintMcpToken());
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

  const url = `${origin}${MCP_PATH}`;
  const base = `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`;
  // A Guest's command needs their token; until it exists, nothing to copy.
  const guestToken = minted?.token ?? "<your guest token>";
  const command = guest
    ? `${base} \\\n  --header "${GUEST_TOKEN_HEADER}: ${guestToken}"`
    : base;
  const json = (headers?: Record<string, string>) =>
    JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: "http",
            url,
            ...(headers ? { headers } : {}),
          },
        },
      },
      null,
      2,
    );
  const oauthJson = json(
    guest ? { [GUEST_TOKEN_HEADER]: guestToken } : undefined,
  );
  const canCopy = !guest || minted !== null;
  // What is shown is exactly what is copied, token and all.
  const tokenCommand = minted
    ? `${base} \\\n  --header "Authorization: Bearer ${minted.token}"`
    : null;
  let step = 0;

  const badge = minted ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span
        className={`eyebrow rounded-sm border border-ink px-1.5 py-0.5 font-bold ${minted.kind === "guest" ? "bg-brass/30" : "bg-ivy/15 text-ivy"}`}
      >
        {minted.kind === "guest"
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
    </div>
  ) : (
    <button
      type="button"
      onClick={() => void mint()}
      disabled={busy}
      aria-busy={busy}
      className="outline-box press eyebrow flex items-center gap-2 rounded-sm bg-federal-blue px-4 py-2 font-bold text-paper disabled:opacity-50"
    >
      <Icon name="spark" className="size-4" />
      {busy ? "Creating…" : guest ? "Create my guest token" : "Create a token"}
    </button>
  );

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
      <DemoBar slug="client-manager" name="Client Manager" />
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6">
        <section className="space-y-3">
          <p className="flex items-center gap-2 font-mono text-xs font-bold tracking-[0.08em] text-federal-blue uppercase">
            <Icon name="plug" className="size-4" /> MCP
          </p>
          <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
            Your client book, inside Claude Code
          </h1>
          <p className="max-w-xl text-ink-muted">
            The same server the desk uses: every client's graph, the documents
            behind each fact, and how sure it is.
          </p>
        </section>

        {guest ? (
          <Step n={++step} title="Get your guest token">
            {badge}
            {error ? <p className="text-sm text-seal-red">{error}</p> : null}
            <p className="text-sm text-ink-muted">
              As a guest you sign in with OAuth and also send this token, so the
              connection belongs to your guest pass. It ends with the pass.
            </p>
          </Step>
        ) : null}

        <Step n={++step} title="Add the server">
          <Code text={command} copy={canCopy ? command : null} />
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">
              .mcp.json
            </summary>
            <div className="mt-2">
              <Code text={oauthJson} copy={canCopy ? oauthJson : null} />
            </div>
          </details>
          <p className="text-sm text-ink-muted">
            {guest
              ? `The ${GUEST_TOKEN_HEADER} header is your guest token, shown whole so you can see what you copy. Keep it to yourself.`
              : "No token to copy: the server signs you in with OAuth. In Claude.ai or Claude Desktop, add it as a custom connector with the same URL."}
          </p>
        </Step>

        <Step n={++step} title="Sign in">
          <p className="text-sm text-ink-muted">
            In Claude Code, run <code className="font-mono text-ink">/mcp</code>
            , pick <code className="font-mono text-ink">{MCP_SERVER_NAME}</code>{" "}
            and choose Authenticate. Your browser opens here: allow it, and
            Claude Code reaches your client book as you.
          </p>
          <p className="flex items-start gap-2 text-sm text-ink-muted">
            <Icon name="spark" className="mt-0.5 size-4 text-brass" />
            <span>
              A Host stays signed in for 30 days; a guest, as long as their
              pass. Revoking a guest pass cuts its clients off at once.
            </span>
          </p>
        </Step>

        <Step n={++step} title="Add the research skill">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={downloadSkill}
              className="outline-box press eyebrow flex items-center gap-2 rounded-sm bg-paper px-3 py-2 font-bold"
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

        <details className="outline-box space-y-3 rounded-sm bg-paper p-4 shadow-hard-sm">
          <summary className="eyebrow cursor-pointer font-bold">
            Client can't sign in with OAuth? Use a token
          </summary>
          <div className="mt-3 space-y-3">
            {guest ? null : badge}
            {guest ? (
              <p className="text-sm text-ink-muted">
                Your guest token, from step 1, also works on its own as the
                bearer.
              </p>
            ) : null}
            {!guest && error ? (
              <p className="text-sm text-seal-red">{error}</p>
            ) : null}
            {minted && tokenCommand ? (
              <>
                <Code text={tokenCommand} copy={tokenCommand} />
                <Code
                  text={json({ Authorization: `Bearer ${minted.token}` })}
                  copy={json({ Authorization: `Bearer ${minted.token}` })}
                />
                <p className="text-sm text-ink-muted">
                  The whole token is shown so you can see what you copy. Keep it
                  to yourself: anyone with it reaches your client book.
                </p>
              </>
            ) : null}
          </div>
        </details>

        <section aria-label="Tools" className="space-y-3">
          <h2 className="eyebrow font-bold text-ink-muted">Tools</h2>
          <ul className="outline-box grid gap-px overflow-hidden rounded-sm bg-ink/20 shadow-hard-md sm:grid-cols-2">
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
                    className="rounded-sm border border-ink bg-brass/30 px-1 font-mono text-[0.6rem] font-bold uppercase"
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
      <span className="outline-box flex size-7 items-center justify-center rounded-sm bg-ink font-mono text-sm font-bold text-paper shadow-hard-sm">
        {n}
      </span>
      <h2 className="self-center font-mono text-lg font-bold uppercase">
        {title}
      </h2>
      <div className="col-start-2 space-y-3">{children}</div>
    </section>
  );
}

function Code({
  text,
  copy,
  quiet = false,
}: {
  text: string;
  copy: string | null;
  quiet?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={`outline-box relative rounded-sm shadow-hard-sm ${quiet ? "bg-paper text-ink" : "bg-ink text-morning-haze"}`}
    >
      <pre
        className={`cm-scroll overflow-x-auto p-4 font-mono ${copy ? "pt-9" : ""} text-[0.8rem] leading-relaxed whitespace-pre`}
      >
        {text}
      </pre>
      <div className="absolute top-1.5 right-1.5 flex gap-1">
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
            className="flex items-center gap-1 rounded-sm border border-paper/40 bg-paper/10 px-2 py-1 font-mono text-[0.65rem] font-bold text-paper uppercase hover:bg-paper/20"
          >
            <Icon name={copied ? "check" : "copy"} className="size-3" />
            {copied ? "copied" : "copy"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
