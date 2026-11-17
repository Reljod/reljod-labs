import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { projects } from "@/content/projects";
import { ACCESS_PATH } from "@/features/access/constants";
import { AccessDeniedError } from "@/features/access/server/gate";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { HarnessApp } from "@/features/harness/components/app";
import { placeOf } from "@/features/harness/domain/place";
import { requireStaff } from "@/features/harness/server/context";
import { listStaff } from "@/features/harness/server/staff";
import "@/features/harness/harness.css";

const project = projects.find((item) => item.slug === "bank-harness");

export const metadata: Metadata = {
  title: "Jod: Harness for Bank · Demo",
  description: project?.summary,
};

type Props = PageProps<"/demos/harness">;

export default function HarnessPage({ searchParams }: Props) {
  return (
    <QueryProvider>
      <Suspense fallback={<div className="hx-shimmer h-dvh" />}>
        <App searchParams={searchParams} />
      </Suspense>
    </QueryProvider>
  );
}

/**
 * Passes the Access gate and resolves the Staff member (`requireStaff`
 * creates the Owner's Workspace with its seed on first use), then hands the
 * client shell who is signed in and where the address points.
 */
async function App({ searchParams }: { searchParams: Props["searchParams"] }) {
  const query = await searchParams;
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string") search.set(name, value);
  }
  const context = await requireStaff().catch((error: unknown) => {
    // The proxy sends visitors to the door first; this is the second gate.
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!context) {
    const here = `/demos/harness${search.size > 0 ? `?${search}` : ""}`;
    redirect(`${ACCESS_PATH}?next=${encodeURIComponent(here)}`);
  }
  const { owner, staff } = context;
  return (
    <HarnessApp
      initialStaff={staff}
      allStaff={await listStaff(owner)}
      initialPlace={placeOf(search)}
    />
  );
}
