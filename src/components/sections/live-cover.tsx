"use client";

import type { ReactNode } from "react";
import { demoPreviews } from "@/components/landing/demo-previews";
import { useCopyMotion } from "@/components/motion/copy-motion";
import type { Project } from "@/content/types";

/**
 * A live demo's moving preview as its project card's cover, on a moving
 * page; elsewhere (Ledger's Ask copy) the still `fallback`.
 */
export function LiveCover({
  project,
  fallback,
}: {
  project: Project;
  fallback: ReactNode;
}) {
  const animated = useCopyMotion();
  const preview = demoPreviews[project.slug];
  if (!animated || !preview) return <>{fallback}</>;
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[16/9] overflow-hidden border-ink border-b-2 bg-limestone"
    >
      <div className="absolute inset-x-0 top-0">{preview(project)}</div>
    </div>
  );
}
