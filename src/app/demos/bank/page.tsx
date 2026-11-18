import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { projects } from "@/content/projects";
import { ACCESS_PATH } from "@/features/access/constants";
import { AccessDeniedError } from "@/features/access/server/gate";
import { isUuid } from "@/features/bank/core/db";
import { BankApp } from "@/features/bank/components/app";
import { BankSkeleton } from "@/features/bank/components/skeleton";
import { BankProvider, type FirstView } from "@/features/bank/components/use-bank";
import { DEMO_PATH, isTab } from "@/features/bank/domain/api";
import type { CustomerSummary, OverviewView } from "@/features/bank/domain/views";
import { read } from "@/features/bank/server/bank";
import { actorOf, requireStaff } from "@/features/bank/server/context";
import "@/features/bank/bank.css";

const project = projects.find((item) => item.slug === "tidewater-bank");

export const metadata: Metadata = {
  title: "Tidewater Bank · Demo",
  description: project?.summary,
};

type Props = PageProps<"/demos/bank">;

export default function BankPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<BankSkeleton />}>
      <App searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Passes the Access gate once and resolves the Staff member (opening the
 * Owner's bank with its seed on first use), reads the first view (the
 * overview and the customers) together, and hands the client shell who is
 * signed in, where the address points and that data, so nothing is asked
 * for again after hydration.
 */
async function App({ searchParams }: { searchParams: Props["searchParams"] }) {
  const query = await searchParams;
  const param = (name: string) => {
    const value = query[name];
    return typeof value === "string" ? value : null;
  };
  const context = await requireStaff().catch((error: unknown) => {
    // The proxy sends visitors to the door first; this is the second gate.
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!context) {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (typeof value === "string") search.set(name, value);
    }
    const here = `${DEMO_PATH}${search.size > 0 ? `?${search}` : ""}`;
    redirect(`${ACCESS_PATH}?next=${encodeURIComponent(here)}`);
  }
  const actor = actorOf(context);
  const [overview, customers] = await Promise.all([
    read(actor, "get_overview", {}) as Promise<OverviewView>,
    read(actor, "list_customers", {}) as Promise<{ customers: CustomerSummary[] }>,
  ]);
  const tab = param("tab");
  const customer = param("customer");
  const session = param("session");
  const first: FirstView = {
    overview,
    customers: customers.customers,
    staff: context.everyone,
    activeStaffId: context.staff.id,
    tab: isTab(tab) ? tab : "bank",
    customerId:
      (isUuid(customer) && customers.customers.some((item) => item.id === customer)
        ? customer
        : null) ?? customers.customers[0]?.id ?? null,
    sessionId: isUuid(session) ? session : null,
  };
  return (
    <BankProvider first={first}>
      <BankApp />
    </BankProvider>
  );
}
