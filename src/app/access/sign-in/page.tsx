import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInForm } from "@/features/access/components/sign-in-form";
import { ACCESS_PATH, GUESTS_PATH } from "@/features/access/constants";
import { currentAccess } from "@/features/access/server/gate";
import { AccessShell, Card, Waiting } from "../shell";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export default function SignInPage() {
  return (
    <AccessShell eyebrow="Hosts" title="Sign in">
      <Suspense fallback={<Waiting />}>
        <SignIn />
      </Suspense>
    </AccessShell>
  );
}

async function SignIn() {
  if ((await currentAccess())?.kind === "host") redirect(GUESTS_PATH);
  return (
    <>
      <Card>
        <p>
          An account opens the demos without a guest code, and can issue guest
          codes for others.
        </p>
        <SignInForm />
      </Card>
      <p className="text-sm text-ink-muted">
        Here with a guest code?{" "}
        <Link href={ACCESS_PATH} className="text-federal-blue underline">
          Enter it instead
        </Link>
        .
      </p>
    </>
  );
}
