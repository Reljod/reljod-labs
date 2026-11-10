import type { Scenario } from "../domain/case-file";
import type { JobId } from "../domain/jobs";

/** Colonnade glyphs: 2px ink stroke, square caps, no fills. */
const JOB_PATHS: Record<JobId, React.ReactNode> = {
  sort: (
    <>
      <path d="M4 6h16M4 12h10M4 18h6" />
      <path d="M17 15l3 3-3 3" />
    </>
  ),
  read: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 11h7M9 15h7M9 7h3" />
    </>
  ),
  match_identity: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16h6M14 10h4M14 14h4" />
    </>
  ),
  check_eligibility: (
    <>
      <path d="M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z" />
    </>
  ),
  verify_payee: (
    <>
      <rect x="3" y="6" width="18" height="12" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  screen: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5L20 20" />
    </>
  ),
  adjudicate: (
    <>
      <path d="M12 3v18M5 21h14M5 7h14M5 7l-2 6h4zM19 7l-2 6h4z" />
    </>
  ),
  verify_entity: (
    <>
      <path d="M4 21V8l8-5 8 5v13z" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  check_census: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-4 2-6 5-6s5 2 5 6M14 20c0-3 1-5 3-5s4 2 4 5" />
    </>
  ),
  reconcile: (
    <>
      <path d="M4 20V10M9 20V6M14 20v-8M19 20V4" />
      <path d="M3 20h18" />
    </>
  ),
  map_ownership: (
    <>
      <rect x="9" y="3" width="6" height="5" />
      <rect x="3" y="16" width="6" height="5" />
      <rect x="15" y="16" width="6" height="5" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  rate_risk: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-6M4 18h16" />
    </>
  ),
  decide: (
    <>
      <path d="M8 3h8v6l3 4H5l3-4z" />
      <path d="M5 17h14v4H5z" />
    </>
  ),
};

export function JobGlyph({ job, size = 18 }: { job: JobId; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {JOB_PATHS[job]}
    </svg>
  );
}

const SCENARIO_PATHS: Record<Scenario, React.ReactNode> = {
  pension_withdrawal: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10M10 20v-5h4v5" />
    </>
  ),
  employer_onboarding: (
    <>
      <rect x="3" y="7" width="18" height="13" />
      <path d="M9 7V4h6v3M3 12h18" />
    </>
  ),
  structure_review: (
    <>
      <rect x="9" y="3" width="6" height="5" />
      <rect x="3" y="16" width="6" height="5" />
      <rect x="15" y="16" width="6" height="5" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  screening_review: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
};

export function ScenarioGlyph({
  scenario,
  size = 18,
}: {
  scenario: Scenario;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {SCENARIO_PATHS[scenario]}
    </svg>
  );
}

export const SCENARIO_LABELS: Record<Scenario, string> = {
  pension_withdrawal: "Pension withdrawals",
  employer_onboarding: "Employers & arrears",
  structure_review: "Structures",
  screening_review: "Screening alerts",
};

export function FileGlyph({
  format,
  size = 16,
}: {
  format: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {format === "csv" ? (
        <>
          <rect x="4" y="3" width="16" height="18" />
          <path d="M4 9h16M4 15h16M10 3v18" />
        </>
      ) : format === "image" ? (
        <>
          <rect x="3" y="5" width="18" height="14" />
          <circle cx="9" cy="10" r="2" />
          <path d="M3 17l6-5 4 3 3-2 5 4" />
        </>
      ) : (
        <>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v4h4" />
        </>
      )}
    </svg>
  );
}

export const OUTCOME_STYLE = {
  pass: { label: "Pass", mark: "✓", tone: "bg-ivy text-paper" },
  fail: { label: "Fail", mark: "✗", tone: "bg-seal-red text-paper" },
  review: { label: "Review", mark: "!", tone: "bg-brass text-ink" },
} as const;

export const RECOMMENDATION_STYLE = {
  approve: {
    stamp: "Approve",
    tone: "text-ivy border-ivy",
    pose: "found" as const,
  },
  refer: {
    stamp: "Refer",
    tone: "text-federal-blue border-federal-blue",
    pose: "think" as const,
  },
  decline: {
    stamp: "Decline",
    tone: "text-seal-red border-seal-red",
    pose: "stamp" as const,
  },
  request_info: {
    stamp: "Need info",
    tone: "text-oak border-oak",
    pose: "confused" as const,
  },
};
