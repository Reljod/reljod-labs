import type { Metadata } from "next";
import { Suspense } from "react";
import { projects } from "@/content/projects";
import { ClientManagerApp } from "@/features/client-manager/components/app";
import { AppSkeleton } from "@/features/client-manager/components/app-skeleton";
import { firstLoad } from "@/features/client-manager/server/first-load";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";

const project = projects.find((item) => item.slug === "client-manager");

export const metadata: Metadata = {
  title: "Client Manager · Demo",
  description: project?.summary,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ClientManagerPage({
  searchParams,
}: PageProps<"/demos/client-manager">) {
  return (
    <QueryProvider>
      <Suspense fallback={<AppSkeleton view="chat" />}>
        <App searchParams={searchParams} />
      </Suspense>
    </QueryProvider>
  );
}

async function App({
  searchParams,
}: {
  searchParams: PageProps<"/demos/client-manager">["searchParams"];
}) {
  const { t } = await searchParams;
  const threadId = typeof t === "string" && UUID.test(t) ? t : null;
  return (
    <ClientManagerApp
      initialThreadId={threadId}
      {...(await firstLoad({ clientId: null, threadId }))}
    />
  );
}
