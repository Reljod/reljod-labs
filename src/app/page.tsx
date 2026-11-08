import { HomeSections } from "@/components/sections/home-sections";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { AskBox } from "@/features/ledger/components/ask-box";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <HomeSections heroAside={<AskBox />} />
      </main>
      <SiteFooter />
    </>
  );
}
