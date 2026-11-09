import type { Metadata } from "next";
import Link from "next/link";
import { Contact } from "@/components/sections/contact";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { LiveBadge } from "@/components/ui/live-badge";
import { projects } from "@/content/projects";
import { AskBox } from "@/features/ledger/components/ask-box";

const ledger = projects.find((project) => project.slug === "ledger");

export const metadata: Metadata = {
  title: "Ledger, the cat banker · Demo",
  description: ledger?.summary,
};

export default function LedgerDemoPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section
          aria-labelledby="ledger-title"
          className="bg-marble bg-[radial-gradient(rgb(20_33_61/0.1)_1px,transparent_1px)] bg-size-[16px_16px]"
        >
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:py-24">
            <div>
              <div className="flex items-center gap-4">
                <Link
                  href="/#demos"
                  className="eyebrow font-bold text-federal-blue underline"
                >
                  ← All demos
                </Link>
                <LiveBadge />
              </div>
              <h1
                id="ledger-title"
                className="mt-6 font-mono text-4xl leading-none font-bold tracking-[-0.02em] uppercase sm:text-6xl"
              >
                {ledger?.title}
              </h1>
              <p className="mt-6 max-w-xl text-xl leading-normal">
                {ledger?.summary}
              </p>
              <ol className="mt-8 max-w-xl space-y-3 border-ink border-t-2 pt-5">
                {ledger?.features?.map((feature, index) => (
                  <li key={feature} className="flex gap-3">
                    <span className="outline-box flex size-6 shrink-0 items-center justify-center bg-paper font-mono text-xs font-bold">
                      {index + 1}
                    </span>
                    {feature}
                  </li>
                ))}
              </ol>
            </div>
            <AskBox />
          </div>
        </section>
        <Contact />
      </main>
      <SiteFooter />
    </>
  );
}
