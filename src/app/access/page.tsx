import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { CodeForm } from "@/features/access/components/code-form";
import { LocalTime } from "@/features/access/components/local-time";
import { quietButtonClass } from "@/features/access/components/styles";
import { GUESTS_PATH, SIGN_IN_PATH } from "@/features/access/constants";
import { safeNextPath } from "@/features/access/domain/guest-pass";
import { signOut } from "@/features/access/server/actions";
import { currentAccess } from "@/features/access/server/gate";
import { AccessShell, Card, Waiting } from "./shell";

export const metadata: Metadata = {
  title: "Open the demos",
  description: "The live demos open with a guest code.",
  robots: { index: false },
};

export default function AccessPage({ searchParams }: PageProps<"/access">) {
  return (
    <AccessShell eyebrow="Live demos" title="Open the demos">
      <Suspense fallback={<Waiting />}>
        <Door searchParams={searchParams} />
      </Suspense>
    </AccessShell>
  );
}

async function Door({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, access] = await Promise.all([searchParams, currentAccess()]);
  const next = safeNextPath(query.next);

  if (access) {
    return (
      <Card>
        {access.kind === "guest" ? (
          <p data-testid="access-state">
            You're in as a guest ({access.label}). Your pass is good until{" "}
            <LocalTime iso={access.expiresAt} />.
          </p>
        ) : (
          <p data-testid="access-state">
            You're signed in
            {access.kind === "host" ? ` as ${access.email}` : ""}. The demos are
            open to you.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <ButtonLink href={next}>Go to the demos</ButtonLink>
          {access.kind === "host" ? (
            <ButtonLink href={GUESTS_PATH} variant="secondary">
              Guest passes
            </ButtonLink>
          ) : null}
          {access.kind !== "e2e" ? (
            <form action={signOut}>
              <button type="submit" className={quietButtonClass}>
                {access.kind === "host" ? "Sign out" : "Leave"}
              </button>
            </form>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <p>
          The demos call a paid AI model, so they open by invitation. Enter the
          guest code you were given. The rest of the site needs no code.
        </p>
        <CodeForm next={next} />
      </Card>
      <p className="text-sm text-ink-muted">
        No code?{" "}
        <Link href="/about#contact" className="text-federal-blue underline">
          Ask Reljod for one
        </Link>
        . Have an account?{" "}
        <Link href={SIGN_IN_PATH} className="text-federal-blue underline">
          Sign in
        </Link>
        .
      </p>
    </>
  );
}
