import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ACCESS_PATH } from "@/features/access/constants";
import { AccessDeniedError } from "@/features/access/server/gate";
import { HARNESS_CONNECT_PATH } from "@/features/harness/domain/mcp-tools";
import { requireStaff } from "@/features/harness/server/context";
import { Connect } from "./connect";
import "@/features/harness/harness.css";

export const metadata: Metadata = {
  title: "Connect Claude · Jod: Harness for Bank",
  description:
    "Connect Claude.ai or Claude Code to the Harness MCP server: Pipelines, records, the Knowledge base, Skills, the Audit trail and the Sandbox.",
};

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-marble" />}>
      <Setup />
    </Suspense>
  );
}

/** A Guest's setup asks for their Harness token beside the OAuth sign-in. */
async function Setup() {
  const context = await requireStaff().catch((error: unknown) => {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!context)
    redirect(`${ACCESS_PATH}?next=${encodeURIComponent(HARNESS_CONNECT_PATH)}`);
  return (
    <Connect guest={context.access.kind === "guest"} staff={context.staff} />
  );
}
