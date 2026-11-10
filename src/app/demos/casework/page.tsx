import type { Metadata } from "next";
import { Desk } from "@/features/casework/components/desk";

export const metadata: Metadata = {
  title: "Teller · Demo",
  description:
    "A specialist agent that runs pension withdrawal, employer onboarding, structure and screening reviews as durable pipelines of reusable jobs, exposed over MCP.",
};

export default function CaseworkDemoPage() {
  return <Desk />;
}
