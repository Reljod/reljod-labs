import { HomeSections } from "@/components/sections/home-sections";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { AskBox } from "@/features/ledger/components/ask-box";
import { AskScreen } from "@/features/ledger/components/ask-screen";

export default function Home() {
  return (
    <AskScreen
      session={null}
      header={<SiteHeader />}
      pageCopy={<HomeSections heroAside={<AskBox />} />}
      footer={<SiteFooter />}
    />
  );
}
