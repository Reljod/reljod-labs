import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { LiveBadge } from "@/components/ui/live-badge";
import { projects } from "@/content/projects";
import { Catalog } from "@/features/client-manager/components/catalog";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";

const project = projects.find((item) => item.slug === "client-manager");

export const metadata: Metadata = {
  title: "Client Manager · Demo",
  description: project?.summary,
};

export default function ClientManagerPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section
          aria-labelledby="cm-title"
          className="border-ink border-b-2 bg-marble bg-[radial-gradient(rgb(20_33_61/0.1)_1px,transparent_1px)] bg-size-[16px_16px]"
        >
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
            <div className="flex items-center gap-4">
              <Link
                href="/#demos"
                className="eyebrow font-bold text-federal-blue underline"
              >
                ← All demos
              </Link>
              <LiveBadge />
            </div>
            <div className="mt-6 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end">
              <div>
                <h1
                  id="cm-title"
                  className="font-mono text-4xl leading-none font-bold tracking-[-0.02em] uppercase sm:text-6xl"
                >
                  {project?.title}
                </h1>
                <p className="mt-6 max-w-xl text-xl leading-normal">
                  {project?.summary}
                </p>
              </div>
              <ol className="space-y-3 border-ink border-t-2 pt-5 lg:border-t-0 lg:border-l-2 lg:pt-0 lg:pl-6">
                {project?.features?.map((feature, index) => (
                  <li key={feature} className="flex gap-3">
                    <span className="outline-box flex size-6 shrink-0 items-center justify-center bg-paper font-mono text-xs font-bold">
                      {index + 1}
                    </span>
                    {feature}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
        <section
          aria-label="Client catalog"
          className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14"
        >
          <QueryProvider>
            <Catalog />
          </QueryProvider>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
