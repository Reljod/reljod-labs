import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { McpConnect } from "@/features/access/components/mcp-connect";
import {
  GUESTS_PATH,
  PROFILE_PATH,
  SIGN_IN_PATH,
} from "@/features/access/constants";
import {
  GUEST_ACCESS_CONNECT_PATH,
  GUEST_ACCESS_TOOLS,
} from "@/features/access/domain/guest-access-mcp";
import { currentAccess } from "@/features/access/server/gate";
import { AccessShell, Card, Waiting } from "../shell";

export const metadata: Metadata = {
  title: "Guest access MCP",
  robots: { index: false },
};

/** How a Host connects Claude, or another MCP client, to Guest access. */
export default function GuestAccessMcpPage() {
  return (
    <AccessShell eyebrow="Guest access" title="Connect an MCP client" wide>
      <Suspense fallback={<Waiting />}>
        <Connect />
      </Suspense>
    </AccessShell>
  );
}

const headingClass = "font-mono text-lg font-bold uppercase";

async function Connect() {
  const access = await currentAccess();
  if (access?.kind !== "host")
    redirect(
      `${SIGN_IN_PATH}?next=${encodeURIComponent(GUEST_ACCESS_CONNECT_PATH)}`,
    );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">Signed in as {access.email}</p>
        <ButtonLink href={GUESTS_PATH} variant="secondary" className="min-h-9">
          Guest access
        </ButtonLink>
      </div>

      <Card>
        <h2 className={headingClass}>Manage guest passes from Claude</h2>
        <p className="text-sm text-ink-muted">
          The Guest access MCP server does what the Guest access page does:
          issue a pass and get its code, extend, renew, revoke, delete and
          restore. It signs in with OAuth as you, and only a Host can allow it.
          A connection lasts 30 days.
        </p>
        <McpConnect />
      </Card>

      <Card>
        <h2 className={headingClass}>Tools</h2>
        <ul className="flex flex-col gap-3">
          {GUEST_ACCESS_TOOLS.map((tool) => (
            <li key={tool.name} className="text-sm">
              <code className="font-mono font-bold">{tool.name}</code>
              {tool.destructive ? (
                <span className="outline-box eyebrow ml-2 rounded-sm bg-seal-red px-2 py-0.5 text-paper">
                  ends access
                </span>
              ) : null}
              <span className="block text-ink-muted">{tool.summary}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-muted">
          Guest codes come back in the client's chat, once, when a pass is
          issued or given a new code. Treat that chat like the code itself.
        </p>
      </Card>

      <Card>
        <h2 className={headingClass}>Disconnect</h2>
        <p className="text-sm text-ink-muted">
          To cut every client off at once, use Disconnect all MCP clients on
          your profile settings. It covers this server, the Client Manager and
          the Harness.
        </p>
        <ButtonLink href={PROFILE_PATH} variant="secondary">
          Profile settings
        </ButtonLink>
      </Card>
    </>
  );
}
