import type { Metadata } from "next";
import { Sieve } from "@/features/name-extraction/components/sieve";

export const metadata: Metadata = {
  title: "Sieve · Demo",
  description:
    "One agent with tools finds every party a 10 to 500 page AML document names, with every alias and page: parallel Reader sub-agents, Skills on demand, code in a sandbox, and a Done gate that will not let it stop early.",
};

export default function NameExtractionDemoPage() {
  return <Sieve />;
}
