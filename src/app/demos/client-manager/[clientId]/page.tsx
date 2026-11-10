import type { Metadata } from "next";
import { Suspense } from "react";
import { Workspace } from "@/features/client-manager/components/workspace";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";

export const metadata: Metadata = {
  title: "Client graph · Client Manager",
};

export default function ClientPage({
  params,
}: PageProps<"/demos/client-manager/[clientId]">) {
  return (
    <main>
      <QueryProvider>
        <Suspense fallback={<div className="cm-shimmer h-dvh" />}>
          <Client params={params} />
        </Suspense>
      </QueryProvider>
    </main>
  );
}

async function Client({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <Workspace clientId={clientId} />;
}
