import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { callbackTrust } from "@/features/access/domain/mcp-clients";
import { currentAccess } from "@/features/access/server/gate";
import { McpConsent } from "@/features/client-manager/components/mcp-consent";
import { parseAuthorizationRequest } from "@/features/client-manager/domain/oauth";
import { env } from "@/features/client-manager/server/env";

export const metadata: Metadata = {
  title: "Connect an MCP client · Client Manager",
  robots: { index: false },
};

/**
 * The OAuth authorization endpoint. The proxy has already sent a visitor
 * without Access through the door and back here.
 */
export default function AuthorizePage({
  searchParams,
}: PageProps<"/demos/client-manager/mcp/authorize">) {
  return (
    <div className="min-h-dvh bg-marble text-ink">
      <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <Suspense fallback={<p className="text-ink-muted">Checking…</p>}>
          <Consent searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function Consent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, access] = await Promise.all([searchParams, currentAccess()]);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
  }
  const parsed = parseAuthorizationRequest(params, env.rateLimitSalt());
  // A mistake goes back to the client only for someone with Access, or to a
  // callback on this machine or a known client's: anyone can register a
  // client with any https callback, so this page is no open redirect.
  if (
    parsed.kind === "error" &&
    (access || callbackTrust(parsed.redirectUri) !== "unknown")
  )
    redirect(parsed.redirect);
  if (parsed.kind !== "ok" || !access) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Can't connect this app
        </h1>
        <p className="text-ink-muted">
          {parsed.kind === "invalid"
            ? parsed.message
            : parsed.kind === "error"
              ? "This sign-in link is not a valid request. Start again from the app."
              : "Open the demos first, then start again from the app."}
        </p>
        <Link
          href="/demos/client-manager/mcp"
          className="text-sm text-federal-blue underline"
        >
          How to connect
        </Link>
      </div>
    );
  }
  const { request } = parsed;
  return (
    <McpConsent
      request={params.toString()}
      clientName={request.client.name}
      callbackHost={new URL(request.redirectUri).host}
      unknownCallback={callbackTrust(request.redirectUri) === "unknown"}
      who={
        access.kind === "host"
          ? access.email
          : access.kind === "guest"
            ? `a guest (${access.label})`
            : "the test suite"
      }
    />
  );
}
