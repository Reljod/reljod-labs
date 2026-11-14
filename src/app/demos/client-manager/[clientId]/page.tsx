import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientManagerApp } from "@/features/client-manager/components/app";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";

export const metadata: Metadata = {
  title: "Client · Client Manager",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = PageProps<"/demos/client-manager/[clientId]">;

/** A client's file, opened full width, with the desk a click away. */
export default function ClientPage({ params, searchParams }: Props) {
  return (
    <QueryProvider>
      <Suspense fallback={<div className="cm-shimmer h-dvh" />}>
        <App params={params} searchParams={searchParams} />
      </Suspense>
    </QueryProvider>
  );
}

async function App({ params, searchParams }: Props) {
  const [{ clientId }, { t }] = await Promise.all([params, searchParams]);
  const threadId = typeof t === "string" && UUID.test(t) ? t : null;
  return (
    <ClientManagerApp initialClientId={clientId} initialThreadId={threadId} />
  );
}
