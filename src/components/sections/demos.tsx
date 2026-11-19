import Link from "next/link";
import { ScrollIn } from "@/components/motion/scroll-in";
import { Icon } from "@/components/ui/icon";
import { Section } from "@/components/ui/section";
import { demosPitch, liveDemos } from "@/content/projects";
import { source, sourcePath } from "@/features/ledger/domain/source-paths";
import { DemoReel } from "./demo-reel";

/**
 * The About page's way to the demos: one door to the catalog, counted from
 * the live demos, with every demo's name running along its foot. The demos
 * themselves are told on `/demos`, not here.
 */
export function Demos() {
  return (
    <Section id="demos" eyebrow="Demos" title="See it working" ground="paper">
      <ScrollIn lean={-1.5}>
        <Link
          href="/demos"
          className="demos-door outline-box press group relative block overflow-hidden rounded-sm bg-ink text-marble"
        >
          <div
            className="grid items-center gap-6 p-6 sm:p-10 md:grid-cols-[auto_1fr_auto] md:gap-10"
            {...source(sourcePath.demos)}
          >
            <p className="demos-figure font-mono text-[clamp(6rem,16vw,10rem)] leading-[0.85] font-bold tabular-nums">
              {demosPitch.figure}
            </p>
            <div>
              <p className="eyebrow text-brass">{demosPitch.label}</p>
              <p className="mt-3 max-w-xl text-lg text-marble">
                {demosPitch.body}
              </p>
            </div>
            <span className="eyebrow inline-flex items-center gap-2 justify-self-start rounded-sm border-2 border-brass bg-brass px-4 py-3 font-bold text-ink md:justify-self-end">
              {demosPitch.cta}
              <Icon name="arrow" size={16} className="demos-arrow" />
            </span>
          </div>
          <DemoReel titles={liveDemos.map((demo) => demo.title)} />
        </Link>
      </ScrollIn>
    </Section>
  );
}
