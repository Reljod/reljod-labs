import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { IssueForm } from "@/features/access/components/issue-form";
import { LocalTime } from "@/features/access/components/local-time";
import { quietButtonClass } from "@/features/access/components/styles";
import { SIGN_IN_PATH } from "@/features/access/constants";
import {
  type GuestPassStatus,
  guestPassStatus,
} from "@/features/access/domain/guest-pass";
import { revokeGuestPass, signOut } from "@/features/access/server/actions";
import { currentAccess } from "@/features/access/server/gate";
import { listGuestPasses } from "@/features/access/server/repository";
import { AccessShell, Card, Waiting } from "../shell";

export const metadata: Metadata = {
  title: "Guest passes",
  robots: { index: false },
};

export default function GuestPassesPage() {
  return (
    <AccessShell eyebrow="Hosts" title="Guest passes" wide>
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
};

async function GuestPasses() {
  const access = await currentAccess();
  if (access?.kind !== "host") redirect(SIGN_IN_PATH);
  const passes = await listGuestPasses();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">Signed in as {access.email}</p>
        <div className="flex items-center gap-3">
          <ButtonLink href="/#demos" variant="secondary" className="min-h-9">
            Demos
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
        {passes.length === 0 ? (
          <p className="text-sm text-ink-muted">No guest passes yet.</p>
        ) : (
          <ul className="flex flex-col">
            {passes.map((pass) => {
              const status = guestPassStatus({
                expiresAt: pass.expires_at,
                revokedAt: pass.revoked_at,
              });
              return (
                <li
                  key={pass.id}
                  data-testid="guest-pass"
                  className="flex flex-wrap items-center justify-between gap-3 border-ink border-t-2 py-3 first:border-t-0 first:pt-0"
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
                    </p>
                  </div>
                  {status === "live" ? (
                    <form action={revokeGuestPass}>
                      <input type="hidden" name="id" value={pass.id} />
                      <button type="submit" className={quietButtonClass}>
                        Revoke
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
