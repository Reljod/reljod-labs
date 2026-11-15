import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { IssueForm } from "@/features/access/components/issue-form";
import { LocalTime } from "@/features/access/components/local-time";
import { PassActions } from "@/features/access/components/pass-actions";
import { quietButtonClass } from "@/features/access/components/styles";
import { PROFILE_PATH, SIGN_IN_PATH } from "@/features/access/constants";
import {
  type GuestPassStatus,
  guestPassStatus,
  LIMITS,
  purgeDate,
} from "@/features/access/domain/guest-pass";
import { signOut } from "@/features/access/server/actions";
import { currentAccess } from "@/features/access/server/gate";
import { listGuestPasses } from "@/features/access/server/repository";
import { AccessShell, Card, Waiting } from "../shell";

export const metadata: Metadata = {
  title: "Guest passes",
  robots: { index: false },
};

export default function GuestPassesPage() {
  return (
    <AccessShell eyebrow="Profile settings" title="Guest access" wide>
      <Suspense fallback={<Waiting />}>
        <GuestPasses />
      </Suspense>
    </AccessShell>
  );
}

const statusClass: Record<GuestPassStatus, string> = {
  live: "bg-ivy text-paper",
  expired: "bg-limestone text-ink",
  revoked: "bg-seal-red text-paper",
  deleted: "bg-ink text-paper",
};

type ListedPass = Awaited<ReturnType<typeof listGuestPasses>>[number];

function PassRow({ pass }: { pass: ListedPass }) {
  const status = guestPassStatus({
    expiresAt: pass.expires_at,
    revokedAt: pass.revoked_at,
    deletedAt: pass.deleted_at,
  });
  return (
    <li
      data-testid="guest-pass"
      className="flex flex-wrap items-start justify-between gap-3 border-ink border-t-2 py-3 first:border-t-0 first:pt-0"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-3 font-semibold">
          <span className="truncate">{pass.label}</span>
          <span
            className={`outline-box eyebrow rounded-sm px-2 py-0.5 ${statusClass[status]}`}
          >
            {status}
          </span>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {status === "deleted" && pass.deleted_at ? (
            <>
              Deleted <LocalTime iso={pass.deleted_at} />. It and what its
              guests saved go for good on{" "}
              <LocalTime iso={purgeDate(pass.deleted_at).toISOString()} />.
            </>
          ) : (
            <>
              {status === "live" ? "Until " : "Ended "}
              <LocalTime
                iso={
                  status === "revoked" && pass.revoked_at
                    ? pass.revoked_at
                    : pass.expires_at
                }
              />{" "}
              · {pass.devices} of {pass.max_devices} device
              {pass.max_devices === 1 ? "" : "s"} used
            </>
          )}
        </p>
      </div>
      <PassActions id={pass.id} label={pass.label} status={status} />
    </li>
  );
}

async function GuestPasses() {
  const access = await currentAccess();
  if (access?.kind !== "host") redirect(SIGN_IN_PATH);
  const passes = await listGuestPasses();
  const issued = passes.filter((pass) => !pass.deleted_at);
  const deleted = passes.filter((pass) => pass.deleted_at);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">Signed in as {access.email}</p>
        <div className="flex items-center gap-3">
          <ButtonLink
            href={PROFILE_PATH}
            variant="secondary"
            className="min-h-9"
          >
            Profile settings
          </ButtonLink>
          <form action={signOut}>
            <button type="submit" className={quietButtonClass}>
              Sign out
            </button>
          </form>
        </div>
      </div>

      <Card>
        <h2 className="font-mono text-lg font-bold uppercase">
          Issue a guest pass
        </h2>
        <p className="text-sm text-ink-muted">
          A pass opens the demos for a limited time. Hand its code to your
          guest; they enter it at /access.
        </p>
        <IssueForm />
      </Card>

      <Card>
        <h2 className="font-mono text-lg font-bold uppercase">Issued</h2>
        <p className="text-sm text-ink-muted">
          What a guest saves stays with their pass. Extend or renew it to let
          them back in, or give it a new code if the old one was lost: either
          way their data is still there.
        </p>
        {issued.length === 0 ? (
          <p className="text-sm text-ink-muted">No guest passes yet.</p>
        ) : (
          <ul className="flex flex-col">
            {issued.map((pass) => (
              <PassRow key={pass.id} pass={pass} />
            ))}
          </ul>
        )}
      </Card>

      {deleted.length > 0 ? (
        <Card>
          <h2 className="font-mono text-lg font-bold uppercase">Deleted</h2>
          <p className="text-sm text-ink-muted">
            Kept {LIMITS.retentionDays} days with everything their guests saved,
            then deleted for good. Restore one to keep it.
          </p>
          <ul className="flex flex-col">
            {deleted.map((pass) => (
              <PassRow key={pass.id} pass={pass} />
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
