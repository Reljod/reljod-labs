import type { Metadata } from "next";
import { AboutSections } from "@/components/sections/about-sections";
import { ProfileCard } from "@/components/sections/profile-card";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { profile } from "@/content/profile";

export const metadata: Metadata = {
  title: `About ${profile.name}`,
  description: profile.intro,
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <AboutSections heroAside={<ProfileCard />} />
      </main>
      <SiteFooter />
    </>
  );
}
