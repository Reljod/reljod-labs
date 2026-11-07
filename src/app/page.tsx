import { Approach } from "@/components/sections/approach";
import { Contact } from "@/components/sections/contact";
import { Experience } from "@/components/sections/experience";
import { Hero } from "@/components/sections/hero";
import { ImpactBand } from "@/components/sections/impact-band";
import { Projects } from "@/components/sections/projects";
import { Services } from "@/components/sections/services";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <ImpactBand />
        <Services />
        <Approach />
        <Experience />
        <Projects />
        <Contact />
      </main>
      <SiteFooter />
    </>
  );
}
