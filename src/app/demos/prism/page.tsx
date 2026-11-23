import type { Metadata } from "next";
import { PrismApp } from "@/features/prism/components/prism-app";

export const metadata: Metadata = {
  title: "Prism · Demo",
  description:
    "Single-forward-pass Decision Models (Nov 2026): split incoming bank paperwork into calibrated probabilities with zero output tokens, race four frontier decision models in a live Tribunal, and sort a live Cascade before paying for a generative LLM.",
};

export default function PrismDemoPage() {
  return <PrismApp />;
}
