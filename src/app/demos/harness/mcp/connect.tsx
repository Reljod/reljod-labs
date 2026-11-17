"use client";

import { useEffect, useState } from "react";
import { api } from "@/features/harness/components/api";
import { HarnessPageBar } from "@/features/harness/components/harness-bar";
import {
  Badge,
  Button,
  buttonClass,
  ErrorNote,
  Panel,
  useWrite,
} from "@/features/harness/components/ui";
import {
  GUEST_TOKEN_HEADER,
  HARNESS_MCP_PATH,
  MCP_SERVER_NAME,
  MCP_TOOL_GROUP_LABEL,
  MCP_TOOL_GROUPS,
  MCP_TOOLS,
} from "@/features/harness/domain/mcp-tools";
import { roleNeeded } from "@/features/harness/domain/permissions";
import { ROLE_LABEL, type Staff } from "@/features/harness/domain/staff";

/** Text to copy, shown whole so the person sees exactly what they copy. */
function Code({ text, copy = true }: { text: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-sm outline-box bg-marble p-3 pr-20 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
      {copy ? (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className={`${buttonClass("secondary", "sm")} absolute top-2 right-2`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * How to connect Claude to the Harness MCP server (ADR 0013): a Claude.ai
 * custom connector or Claude Code, signing in with OAuth and choosing the
 * Staff member Claude acts as; the Plugin with the Workspace's Skills; a
 * pasted token behind a fold; and every tool the server offers.
 */
export function Connect({ guest, staff }: { guest: boolean; staff: Staff }) {
  const [origin, setOrigin] = useState("https://your-site");
  useEffect(() => setOrigin(window.location.origin), []);
  const mint = useWrite(api.mcp.token);
  const minted = mint.result;

  const url = `${origin}${HARNESS_MCP_PATH}`;
  const add = `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`;
  const guestToken = minted?.token ?? "<your Harness token>";
  const command = guest
    ? `${add} \\\n  --header "${GUEST_TOKEN_HEADER}: ${guestToken}"`
    : add;
  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: "http",
          url,
          ...(guest ? { headers: { [GUEST_TOKEN_HEADER]: guestToken } } : {}),
        },
      },
    },
    null,
    2,
  );
  const tokenCommand = minted
    ? `${add} \\\n  --header "Authorization: Bearer ${minted.token}"`
    : null;

  const mintButton = (
    <div className="space-y-2">
      <Button
        variant="primary"
        onClick={() => void mint.run()}
        pending={mint.pending}
        pendingLabel="Creating…"
        disabled={minted !== null}
      >
        {minted ? "Token created" : "Create a token"}
      </Button>
      <ErrorNote>{mint.error}</ErrorNote>
      {minted ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Badge tone="blue">
            Acts as {minted.staff.name} ({ROLE_LABEL[minted.staff.role]})
          </Badge>
          until{" "}
          {new Date(minted.expiresAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-dvh bg-marble text-ink">
      <HarnessPageBar />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <section className="space-y-2">
          <p className="eyebrow font-bold text-federal-blue">MCP</p>
          <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
            Connect Claude to the Harness
          </h1>
          <p className="max-w-xl text-sm text-ink-muted">
            The built-in chat and Claude use the same server: every Pipeline,
            the records, the Knowledge base, the Skills, the Audit trail and the
            Sandbox. Claude acts as one Staff member, chosen when you sign in,
            and it can never give an Approval.
          </p>
        </section>

        <Panel eyebrow="Server" title="The address">
          <Code text={url} />
        </Panel>

        <Panel
          eyebrow="Claude.ai or Claude Desktop"
          title="Add a custom connector"
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Settings, Connectors, Add custom connector.</li>
            <li>Paste the address above and save.</li>
            <li>
              Connect: this site opens, you choose who Claude acts as, and
              Allow.
            </li>
          </ol>
          {guest ? (
            <p className="mt-3 text-sm text-ink-muted">
              As a guest, your sign-in must also carry your Harness token in the{" "}
              {GUEST_TOKEN_HEADER} header, which a custom connector cannot send.
              Use Claude Code below.
            </p>
          ) : null}
        </Panel>

        <Panel eyebrow="Claude Code" title="Add the server">
          <div className="space-y-3">
            {guest ? (
              <>
                <p className="text-sm text-ink-muted">
                  As a guest, create your Harness token first: it ties the
                  sign-in to your guest pass and ends with it.
                </p>
                {mintButton}
              </>
            ) : null}
            <Code text={command} copy={!guest || minted !== null} />
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-muted hover:text-ink">
                Or in .mcp.json
              </summary>
              <div className="mt-2">
                <Code text={mcpJson} copy={!guest || minted !== null} />
              </div>
            </details>
            <p className="text-sm text-ink-muted">
              Then run <code className="font-mono text-ink">/mcp</code>, pick{" "}
              <code className="font-mono text-ink">{MCP_SERVER_NAME}</code> and
              choose Authenticate. Your browser opens here; choose who Claude
              acts as and Allow.
            </p>
          </div>
        </Panel>

        <Panel
          eyebrow="Plugin"
          title="The Workspace's Skills for Claude"
          actions={
            <a
              href={api.plugin.href()}
              className={buttonClass("secondary", "sm")}
              download
            >
              Download Claude plugin
            </a>
          }
        >
          <p className="text-sm text-ink-muted">
            A plugin built from your Workspace's Skills as they stand now, with
            this server's address. Install it to give Claude the same Skills as
            the chat.
          </p>
        </Panel>

        {!guest ? (
          <details className="outline-box rounded-sm bg-paper p-4 shadow-hard-sm">
            <summary className="eyebrow cursor-pointer font-bold">
              No OAuth? Paste a token instead
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-sm text-ink-muted">
                For a client that cannot sign in. The token acts as {staff.name}{" "}
                ({ROLE_LABEL[staff.role]}), who you are signed in as now, and is
                shown whole. Anyone holding it reaches your Workspace until it
                ends, so keep it out of shared files.
              </p>
              {mintButton}
              {tokenCommand ? <Code text={tokenCommand} /> : null}
            </div>
          </details>
        ) : null}

        <Panel
          eyebrow="Tools"
          title={`${MCP_TOOLS.length} tools`}
          bodyClassName=""
        >
          <div className="divide-y divide-ink/10">
            {MCP_TOOL_GROUPS.map((group) => {
              const tools = MCP_TOOLS.filter((tool) => tool.group === group);
              if (tools.length === 0) return null;
              return (
                <section key={group} className="space-y-2 px-4 py-3">
                  <h3 className="eyebrow text-[0.65rem] text-ink-muted">
                    {MCP_TOOL_GROUP_LABEL[group]}
                  </h3>
                  <ul className="space-y-2">
                    {tools.map((tool) => (
                      <li key={tool.name} className="text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-xs font-semibold">
                            {tool.name}
                          </code>
                          {tool.permission &&
                          roleNeeded(tool.permission) === "admin" ? (
                            <Badge tone="amber">Admin</Badge>
                          ) : null}
                        </div>
                        <p className="text-ink-muted">{tool.description}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <p className="border-ink border-t-2 px-4 py-3 text-xs text-ink-muted">
            No tool gives an Approval or settles a Conflict: a person does that
            in the app.
          </p>
        </Panel>
      </main>
    </div>
  );
}
