import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import {
  PasswordForm,
  ProfileForm,
} from "@/features/access/components/settings-forms";
import { quietButtonClass } from "@/features/access/components/styles";
import { GUESTS_PATH, SIGN_IN_PATH } from "@/features/access/constants";
import { LIMITS } from "@/features/access/domain/guest-pass";
import { signOut } from "@/features/access/server/actions";
import { currentAccess } from "@/features/access/server/gate";
import { countLivePasses } from "@/features/access/server/repository";
import { AccessShell, Card, Waiting } from "../shell";

export const metadata: Metadata = {
  title: "Profile settings",
  robots: { index: false },
};

export default function ProfilePage() {
  return (
    <AccessShell eyebrow="Account" title="Profile settings" wide>
      <Suspense fallback={<Waiting />}>
        <Profile />
      </Suspense>
    </AccessShell>
  );
}

const headingClass = "font-mono text-lg font-bold uppercase";

async function Profile() {
  const access = await currentAccess();
  if (access?.kind !== "host") redirect(SIGN_IN_PATH);
  const live = await countLivePasses();

  return (
    <>
      <Card>
        <h2 className={headingClass}>Guest access</h2>
        <p data-testid="guest-access-summary">
          {live === 0
            ? "No guest passes are live. Issue one to let someone into the demos for a limited time."
            : `${live} of ${LIMITS.maxLivePasses} guest passes ${live === 1 ? "is" : "are"} live.`}
        </p>
        <div className="flex flex-wrap gap-4">
          <ButtonLink href={GUESTS_PATH}>Open guest access</ButtonLink>
          <ButtonLink href="/#demos" variant="secondary">
            Go to the demos
          </ButtonLink>
        </div>
      </Card>

      <div className="grid items-start gap-8 md:grid-cols-2">
        <Card>
          <h2 className={headingClass}>Profile</h2>
          <ProfileForm name={access.name} email={access.email} />
        </Card>
        <Card>
          <h2 className={headingClass}>Password</h2>
          <PasswordForm />
        </Card>
      </div>

      <form action={signOut}>
        <button type="submit" className={quietButtonClass}>
          Sign out
        </button>
      </form>
    </>
  );
}
