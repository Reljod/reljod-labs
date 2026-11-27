import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { callbackTrust } from "@/features/access/domain/mcp-clients";
import { HarnessPageBar } from "@/features/harness/components/harness-bar";
import { HARNESS_CONNECT_PATH } from "@/features/harness/domain/mcp-tools";
import { parseAuthorizationRequest } from "@/features/harness/domain/oauth";
import { env } from "@/features/harness/server/env";
import { signedIn } from "@/features/harness/server/page";
import { ConsentForm } from "./consent-form";
import "@/features/harness/harness.css";

export const metadata: Metadata = {
  title: "Connect Claude · Jod: Harness for Bank",
  robots: { index: false },
};

/**
 * The Harness's OAuth authorization endpoint. The proxy has already sent a
 * visitor without Access through the door and back here; next.config.ts
 * refuses to let it be framed.
 */
export default function AuthorizePage({
  searchParams,
}: PageProps<"/demos/harness/mcp/authorize">) {
  return (
    <div className="min-h-dvh bg-marble text-ink">
      <HarnessPageBar />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Suspense fallback={<p className="text-ink-muted">Checking…</p>}>
          <Consent searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

function CannotConnect({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <h1 className="font-mono text-2xl leading-tight font-bold uppercase">
        Can't connect this app
      </h1>
      <p className="text-ink-muted">{message}</p>
      <Link
        href={HARNESS_CONNECT_PATH}
        className="outline-box press eyebrow inline-flex rounded-sm bg-paper px-3 py-1.5 font-bold"
      >
        How to connect Claude
      </Link>
    </div>
  );
}

async function Consent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
  }
  const parsed = parseAuthorizationRequest(params, env.rateLimitSalt());
  if (parsed.kind === "invalid")
    return <CannotConnect message={parsed.message} />;
  const signed = await signedIn();
  if (!signed)
    return (
      <CannotConnect message="Open the demos first, then start again from the app." />
    );
  // Only after Access: anyone can register a client with any https
  // callback, so a visitor without Access is never redirected to one.
  if (parsed.kind === "error") redirect(parsed.redirect);
  const { request } = parsed;
  const { access, staff } = signed.caller;
  return (
    <ConsentForm
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
      staff={signed.everyone}
      current={staff.id}
    />
  );
}
