import Image from "next/image";
import type { CSSProperties } from "react";
import type { Project } from "@/content/types";

/** Where each check lands on the 960×726 cover, in percent, top to bottom. */
const FINDINGS = [
  { label: "Name matches", left: 32, top: 27.5, width: 14, height: 11 },
  { label: "Date of birth", left: 51.8, top: 40, width: 12.5, height: 6 },
  { label: "Not expired", left: 71, top: 56.5, width: 12.5, height: 6 },
  { label: "No tampering", left: 9, top: 75, width: 73.5, height: 12 },
];

/** The scan line covers the page in the first 60% of the loop; each box stamps in as it passes. */
const SWEEP_SECONDS = 5.6 * 0.6;

export function DocumentCompliancePreview({ project }: { project: Project }) {
  return (
    <div className="relative aspect-[960/726] overflow-hidden bg-limestone">
      {project.cover ? (
        <Image
          src={project.cover.src}
          alt={project.cover.alt}
          fill
          priority
          sizes="(min-width: 1024px) 640px, 100vw"
          className="object-cover"
        />
      ) : null}
      {FINDINGS.map((finding) => (
        <div
          key={finding.label}
          aria-hidden="true"
          className="absolute border-2 border-ivy bg-ivy/10 motion-safe:animate-find-box"
          style={
            {
              left: `${finding.left}%`,
              top: `${finding.top}%`,
              width: `${finding.width}%`,
              height: `${finding.height}%`,
              animationDelay: `${((finding.top + finding.height) / 100) * SWEEP_SECONDS}s`,
            } as CSSProperties
          }
        >
          <span className="eyebrow absolute -top-5 left-[-2px] whitespace-nowrap bg-ivy px-1.5 py-px text-[0.625rem] text-paper">
            ✓ {finding.label}
          </span>
        </div>
      ))}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 h-0.5 bg-clear-sky shadow-[0_0_14px_4px_rgb(111_160_220/0.65)] motion-safe:animate-scan-sweep motion-reduce:hidden"
      />
      <p className="eyebrow absolute right-3 bottom-3 outline-box bg-paper px-2 py-1 text-[0.625rem]">
        Pre-screen · {FINDINGS.length} checks traced
      </p>
    </div>
  );
}
