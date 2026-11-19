import { cacheLife } from "next/cache";
import { ScrollIn } from "@/components/motion/scroll-in";
import { Section } from "@/components/ui/section";
import { credentials, experience } from "@/content/experience";
import { source, sourcePath } from "@/features/ledger/domain/source-paths";
import { CareerFile } from "./career-file";
import { careerRuler } from "./career-span";

/**
 * Where each job sits on the career ruler. A "Present" job runs to this
 * month, so the ruler is worked out once a day, on the server, and the
 * browser gets the same numbers as the HTML.
 */
async function currentRuler() {
  "use cache";
  cacheLife("days");
  return careerRuler(
    experience.map((job) => job.period),
    new Date(),
  );
}

export async function Experience() {
  const ruler = await currentRuler();
  return (
    <Section
      id="experience"
      eyebrow="Experience"
      title="Seven years, from finance data to digital banking"
      intro="Two years at a global financial data company, three inside a leading Philippine digital bank, and the last two shipping production AI."
    >
      <CareerFile ruler={ruler} />

      <dl className="mt-12 grid gap-8 md:grid-cols-2">
        {credentials.map((credential, index) => (
          <ScrollIn
            key={credential.title}
            className="border-ink border-t-2 pt-4"
            {...source(sourcePath.credential(index))}
          >
            <dt className="font-semibold">{credential.title}</dt>
            <dd className="mt-1 text-sm text-ink-muted">{credential.detail}</dd>
          </ScrollIn>
        ))}
      </dl>
    </Section>
  );
}
