import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { projects } from "@/content/projects";
import { ACCESS_PATH } from "@/features/access/constants";
import { HarnessApp } from "@/features/harness/components/app";
import { HarnessSkeleton } from "@/features/harness/components/harness-skeleton";
import { HarnessQueryProvider } from "@/features/harness/components/query-provider";
import { placeOf } from "@/features/harness/domain/place";
import { signedIn } from "@/features/harness/server/page";
import "@/features/harness/harness.css";

const project = projects.find((item) => item.slug === "bank-harness");

export const metadata: Metadata = {
  title: "Jod: Harness for Bank · Demo",
  description: project?.summary,
};

type Props = PageProps<"/demos/harness">;

export default function HarnessPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<HarnessSkeleton />}>
      <App searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Passes the Access gate once and resolves the Staff member (creating the
 * Owner's Workspace with its seed on first use), reads the first view of the
 * tabs that open (Chat's, and the address's tab's) in parallel through the
 * same services the GET routes use, and hands the client shell who is
 * signed in, where the address points, and that data, so nothing is asked
 * for again after hydration.
 */
async function App({ searchParams }: { searchParams: Props["searchParams"] }) {
  const query = await searchParams;
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string") search.set(name, value);
  }
  const signed = await signedIn();
  if (!signed) {
    // The proxy sends visitors to the door first; this is the second gate.
    const here = `/demos/harness${search.size > 0 ? `?${search}` : ""}`;
    redirect(`${ACCESS_PATH}?next=${encodeURIComponent(here)}`);
  }
  const { caller, everyone, services } = signed;
  const place = placeOf(search);
  const firstView = await services.firstView(caller, place);
  return (
    <HarnessQueryProvider firstView={firstView} staffId={caller.staff.id}>
      <HarnessApp
        initialStaff={caller.staff}
        allStaff={everyone}
        initialPlace={place}
      />
    </HarnessQueryProvider>
  );
}
