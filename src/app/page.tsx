import { Contact } from "@/components/sections/contact";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { AboutTeaser } from "@/components/showcase/about-teaser";
import { Bench } from "@/components/showcase/bench";
import { LabHero } from "@/components/showcase/lab-hero";
import { LiveDemos } from "@/components/showcase/live-demos";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <LabHero />
        <LiveDemos />
        <Bench />
        <AboutTeaser />
        <Contact />
      </main>
      <SiteFooter />
    </>
  );
}
