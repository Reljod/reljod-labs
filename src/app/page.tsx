import { DemoPicker } from "@/components/landing/demo-picker";
import { DeskScene } from "@/components/landing/desk-scene";
import { LabScene } from "@/components/landing/lab-scene";
import { LensScene } from "@/components/landing/lens-scene";
import { LandingMotion } from "@/components/landing/reveal";
import { SceneIndex } from "@/components/landing/scene-index";
import { WhoScene } from "@/components/landing/who-scene";
import { Contact } from "@/components/sections/contact";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { Bench } from "@/components/showcase/bench";

/**
 * The landing page plays as a short film in scenes, for a visitor who may not
 * work in tech: what the site is, who made it, what the AI does, the projects
 * and what the site is for. Every scene has something to touch, and the Index
 * jumps anywhere, so nobody has to sit through it.
 */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <LandingMotion>
        <main>
          <DeskScene />
          <WhoScene />
          <LensScene />
          <DemoPicker />
          <Bench />
          <LabScene />
          <Contact />
        </main>
        <SceneIndex />
      </LandingMotion>
      <SiteFooter />
    </>
  );
}
