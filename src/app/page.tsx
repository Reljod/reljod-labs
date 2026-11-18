import { Everything } from "@/components/landing/everything";
import { OpeningChapter } from "@/components/landing/opening-chapter";
import { RolodexChapter } from "@/components/landing/rolodex-chapter";
import { SceneIndex } from "@/components/landing/scene-index";
import { StampChapter } from "@/components/landing/stamp-chapter";
import { UpCloseChapter } from "@/components/landing/up-close-chapter";
import { WhoChapter } from "@/components/landing/who-chapter";
import { CopyMotionProvider } from "@/components/motion/copy-motion";
import { Contact } from "@/components/sections/contact";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { Bench } from "@/components/showcase/bench";

/**
 * The landing page is a tour you scroll through, for a visitor who may not
 * work in tech. Each chapter pins to the screen and scrolling plays it: the
 * pile of paper the AI reads, two documents checked up close, who's behind
 * it, the projects on a Rolodex, and what the site is. Then everything is
 * laid out to browse. The Index and "Skip the tour" jump anywhere.
 */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <CopyMotionProvider animated>
        <main>
          <OpeningChapter />
          <UpCloseChapter />
          <WhoChapter />
          <RolodexChapter />
          <StampChapter />
          <Everything />
          <Bench />
          <Contact />
        </main>
        <SceneIndex />
      </CopyMotionProvider>
      <SiteFooter />
    </>
  );
}
