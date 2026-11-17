import type { SampleFile } from "./types";

/**
 * Case papers for the Pipelines, served from `public/harness/samples/`.
 * Each names a seeded Member or Employer (`domain/pipelines/sample-book.ts`)
 * and says SPECIMEN. The two Schedules and the remittance advice are written
 * by `scripts/build-harness-samples.mts` from the sample book, so their
 * amounts agree with what a Workspace is seeded with; the request packs are
 * hand-written and carry no dates the checks rely on (those come from the
 * Member record).
 */
export const CASE_SAMPLES: SampleFile[] = [
  {
    id: "request-overseas-transfer",
    title: "Overseas transfer: Alison Fairweather-Kent",
    about:
      "Left Cayman three years ago and asks to move her pension to a plan in Canada. Every paper is there; it should pass.",
    path: "/harness/samples/request-overseas-transfer.md",
    name: "fairweather-kent-overseas-transfer.md",
    type: "text/markdown",
    group: "member request",
  },
  {
    id: "request-overseas-too-soon",
    title: "Overseas transfer too soon: Gareth Penhallow",
    about:
      "Left Cayman 14 months ago and asks for a cash refund or a transfer to the UK. Fails the two-year tests.",
    path: "/harness/samples/request-overseas-too-soon.md",
    name: "penhallow-leaving-cayman.md",
    type: "text/markdown",
    group: "member request",
  },
  {
    id: "request-property-missing-letter",
    title: "Property deposit: Rochelle Tibbetts-Arden",
    about:
      "A Caymanian asks for CI$40,000 towards a deposit. The lender's letter is missing, so the Run asks for it.",
    path: "/harness/samples/request-property-missing-letter.md",
    name: "tibbetts-arden-property-deposit.md",
    type: "text/markdown",
    group: "member request",
  },
  {
    id: "request-retirement",
    title: "Retirement: Cuthbert Lindqvist-Mora",
    about: "Aged 66 and asks to retire into a Retirement Savings Arrangement.",
    path: "/harness/samples/request-retirement.md",
    name: "lindqvist-mora-retirement.md",
    type: "text/markdown",
    group: "member request",
  },
  {
    id: "request-transfer-out",
    title: "Transfer to a new employer's plan: Desmond Arbery-Lyle",
    about:
      "Left Wrayfield Hospitality last month and directs a transfer to his new employer's plan.",
    path: "/harness/samples/request-transfer-out.md",
    name: "arbery-lyle-transfer-direction.md",
    type: "text/markdown",
    group: "member request",
  },
  {
    id: "schedule-clean",
    title: "Schedule: Pelican Shoal Marine Services (clean)",
    about:
      "Last month's contribution Schedule as CSV. Matches the money received; it should post.",
    path: "/harness/samples/schedule-pelican-shoal.csv",
    name: "pelican-shoal-schedule.csv",
    type: "text/csv",
    group: "contributions",
  },
  {
    id: "schedule-wrong-rate",
    title: "Schedule: Calloway Bight Logistics (4% and a stranger)",
    about:
      "Last month's Schedule as XLSX. The employer share is 4% and one line is not a Member; it should be held with a query.",
    path: "/harness/samples/schedule-calloway-bight.xlsx",
    name: "calloway-bight-schedule.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    group: "contributions",
  },
  {
    id: "remittance-advice",
    title: "Remittance advice: Pelican Shoal Marine Services",
    about:
      "The Employer's note of last month's payment, for asking the Agent to match it.",
    path: "/harness/samples/remittance-advice-pelican-shoal.txt",
    name: "pelican-shoal-remittance-advice.txt",
    type: "text/plain",
    group: "contributions",
  },
];
