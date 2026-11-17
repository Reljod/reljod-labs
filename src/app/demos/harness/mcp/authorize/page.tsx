import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccessDeniedError } from "@/features/access/server/gate";
import { HARNESS_CONNECT_PATH } from "@/features/harness/domain/mcp-tools";
import { parseAuthorizationRequest } from "@/features/harness/domain/oauth";
import { requireStaff } from "@/features/harness/server/context";
import { env } from "@/features/harness/server/env";
import { listStaff } from "@/features/harness/server/staff";
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
      <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
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
      <h1 className="text-2xl font-semibold tracking-tight">
        Can't connect this app
      </h1>
      <p className="text-ink-muted">{message}</p>
      <Link
        href={HARNESS_CONNECT_PATH}
        className="text-sm text-federal-blue underline"
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
  const context = await requireStaff().catch((error: unknown) => {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!context)
    return (
      <CannotConnect message="Open the demos first, then start again from the app." />
    );
  // Only after Access: the redirect goes to a URI the client registered.
  if (parsed.kind === "error") redirect(parsed.redirect);
  const { request } = parsed;
  const { access, owner, staff } = context;
  return (
    <ConsentForm
      request={params.toString()}
      clientName={request.client.name}
      callbackHost={new URL(request.redirectUri).host}
      who={
        access.kind === "host"
          ? access.email
          : access.kind === "guest"
            ? `a guest (${access.label})`
            : "the test suite"
      }
      staff={await listStaff(owner)}
      current={staff.id}
    />
  );
}
