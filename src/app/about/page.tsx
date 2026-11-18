import type { Metadata } from "next";
import { CopyMotionProvider } from "@/components/motion/copy-motion";
import { PrintIn } from "@/components/motion/print-in";
import { AboutSections } from "@/components/sections/about-sections";
import { ProfileCard } from "@/components/sections/profile-card";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { profile } from "@/content/profile";

export const metadata: Metadata = {
  title: `About ${profile.name}`,
  description: profile.intro,
};

/**
 * The About page moves as you scroll, like the landing page. Ledger's Ask
 * sessions render the same sections without `CopyMotionProvider`, so they
 * stay still there for him to measure and cut.
 */
export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <CopyMotionProvider animated>
        <main data-moving="">
          <AboutSections
            heroAside={
              <PrintIn>
                <ProfileCard />
              </PrintIn>
            }
          />
        </main>
      </CopyMotionProvider>
      <SiteFooter />
    </>
  );
}
