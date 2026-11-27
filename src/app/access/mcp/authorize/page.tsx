import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { SIGN_IN_PATH } from "@/features/access/constants";
import {
  GUEST_ACCESS_AUTHORIZE_PATH,
  GUEST_ACCESS_CONNECT_PATH,
} from "@/features/access/domain/guest-access-mcp";
import { accessServices } from "@/features/access/server/container";
import { currentAccess } from "@/features/access/server/gate";
import { AccessShell, Card, Waiting } from "../../shell";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = {
  title: "Connect an MCP client · Guest access",
  robots: { index: false },
};

/**
 * The Guest access OAuth authorization endpoint, for Hosts only. The proxy
 * sends anyone else to the Host sign-in, which comes back here; the site's
 * headers refuse to let it be framed.
 */
export default function AuthorizePage({
  searchParams,
}: PageProps<"/access/mcp/authorize">) {
  return (
    <AccessShell eyebrow="Guest access" title="Connect an MCP client">
      <Suspense fallback={<Waiting />}>
        <Consent searchParams={searchParams} />
      </Suspense>
    </AccessShell>
  );
}

function CannotConnect({ message }: { message: string }) {
  return (
    <Card>
      <h2 className="font-mono text-lg font-bold uppercase">
        Can't connect this app
      </h2>
      <p className="text-ink-muted">{message}</p>
      <ButtonLink href={GUEST_ACCESS_CONNECT_PATH} variant="secondary">
        How to connect
      </ButtonLink>
    </Card>
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
  const review = accessServices().mcpConnect.review(
    await currentAccess(),
    params,
  );
  switch (review.kind) {
    case "invalid":
      return <CannotConnect message={review.message} />;
    case "sign-in":
      return redirect(
        `${SIGN_IN_PATH}?next=${encodeURIComponent(`${GUEST_ACCESS_AUTHORIZE_PATH}?${params}`)}`,
      );
    case "redirect":
      return redirect(review.to);
    case "ask":
      return (
        <Card>
          <ConsentForm
            request={review.request}
            clientName={review.clientName}
            callbackHost={review.callbackHost}
            unknownCallback={review.unknownCallback}
            email={review.email}
          />
        </Card>
      );
  }
}
