import type { Metadata } from "next";
import { Catalog } from "@/components/catalog/catalog";
import { CopyMotionProvider } from "@/components/motion/copy-motion";
import { ScrollRule } from "@/components/motion/scroll-rule";
import { Contact } from "@/components/sections/contact";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { catalog } from "@/content/landing";

export const metadata: Metadata = {
  title: "Demo catalog · Reljod Labs",
  description: catalog.intro,
};

/** Every live demo on one page, to search, shuffle and watch at your own pace. */
export default function CatalogPage() {
  return (
    <>
      <SiteHeader />
      <CopyMotionProvider animated>
        <main className="overflow-x-clip bg-marble">
          <section id="catalog" aria-labelledby="catalog-title">
            <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
              <Catalog
                heading={
                  <header className="relative max-w-3xl">
                    <p className="eyebrow mb-3 text-ink-muted">The catalog</p>
                    <h1
                      id="catalog-title"
                      className="font-mono text-4xl leading-[1.05] font-bold uppercase sm:text-6xl"
                    >
                      {catalog.title}
                    </h1>
                    <p className="relative mt-5 text-lg text-ink-muted">
                      {catalog.intro}
                      <ScrollRule
                        axis="x"
                        className="-bottom-4 left-0 h-1 w-28"
                      />
                    </p>
                  </header>
                }
              />
            </div>
          </section>
          <Contact />
        </main>
      </CopyMotionProvider>
      <SiteFooter />
    </>
  );
}
