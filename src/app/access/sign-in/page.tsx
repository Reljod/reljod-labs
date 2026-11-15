import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInForm } from "@/features/access/components/sign-in-form";
import { ACCESS_PATH, PROFILE_PATH } from "@/features/access/constants";
import { safeNextPath } from "@/features/access/domain/guest-pass";
import { currentAccess } from "@/features/access/server/gate";
import { AccessShell, Card, Waiting } from "../shell";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export default function SignInPage({
  searchParams,
}: PageProps<"/access/sign-in">) {
  return (
    <AccessShell eyebrow="Hosts" title="Sign in">
      <Suspense fallback={<Waiting />}>
        <SignIn searchParams={searchParams} />
      </Suspense>
    </AccessShell>
  );
}

async function SignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, access] = await Promise.all([searchParams, currentAccess()]);
  // Sent here from a demo (an MCP client's sign-in, say): go back after.
  const next = query.next ? safeNextPath(query.next) : null;
  if (access?.kind === "host") redirect(next ?? PROFILE_PATH);
  return (
    <>
      <Card>
        <p>
          An account opens the demos without a guest code, and can issue guest
          codes for others.
        </p>
        <SignInForm next={next} />
      </Card>
      <p className="text-sm text-ink-muted">
        Here with a guest code?{" "}
        <Link
          href={
            next
              ? `${ACCESS_PATH}?next=${encodeURIComponent(next)}`
              : ACCESS_PATH
          }
          className="text-federal-blue underline"
        >
          Enter it instead
        </Link>
        .
      </p>
    </>
  );
}
