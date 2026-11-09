import type { ReactNode } from "react";
import { Approach } from "./approach";
import { Contact } from "./contact";
import { Experience } from "./experience";
import { Hero } from "./hero";
import { ImpactBand } from "./impact-band";
import { Projects } from "./projects";
import { Services } from "./services";

/**
 * Every section of the About page, in order. Ledger's Ask sessions render the
 * same sections as the page copy he takes apart, so both stay identical.
 */
export function AboutSections({ heroAside }: { heroAside?: ReactNode }) {
  return (
    <>
      <Hero aside={heroAside} />
      <ImpactBand />
      <Services />
      <Approach />
      <Experience />
      <Projects />
      <Contact />
    </>
  );
}
