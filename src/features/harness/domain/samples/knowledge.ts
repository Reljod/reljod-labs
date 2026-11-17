import type { SampleFile } from "./types";

/**
 * Documents to add to the Knowledge base (served from
 * `public/harness/samples/kb-*`). Built by
 * `scripts/build-harness-knowledge.mts` (the PDF and the workbook) or kept as
 * written (the CSV and the memo). What each one shows is in `about`.
 */
export const KNOWLEDGE_SAMPLES: SampleFile[] = [
  {
    id: "kb-circular-2023-07",
    title: "Pensions Circular 2023-07 (PDF)",
    about:
      "New property withdrawal caps (CI$50,000 and CI$100,000 from 9 Dec 2023). The Member Guide still says CI$35,000, so adding it raises a Conflict where “the new one supersedes” is the right call.",
    path: "/harness/samples/kb-pensions-circular-2023-07.pdf",
    name: "kb-pensions-circular-2023-07.pdf",
    type: "application/pdf",
    group: "knowledge",
  },
  {
    id: "kb-contribution-table",
    title: "Contribution table by earnings (CSV)",
    about:
      "Employer and employee 5% by annual earnings, capped at the CI$87,000 YMPE. Each row group keeps its column names, so a number is found with what it means. No Conflict.",
    path: "/harness/samples/kb-contribution-table.csv",
    name: "kb-contribution-table.csv",
    type: "text/csv",
    group: "knowledge",
  },
  {
    id: "kb-fees-and-limits",
    title: "Rates, fees and limits (XLSX, two sheets)",
    about:
      "A workbook with a Rates sheet and a Fees and limits sheet. Each sheet becomes its own Passages. It agrees with the guides, so no Conflict.",
    path: "/harness/samples/kb-fees-and-limits.xlsx",
    name: "kb-fees-and-limits.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    group: "knowledge",
  },
  {
    id: "kb-remittance-reminder-memo",
    title: "Remittance reminder memo (text)",
    about:
      "A memo that restates the 15th-of-the-month deadline, 5% and 5%, and the CI$87,000 cap. It agrees with the seed guides: the happy path, with no Conflict.",
    path: "/harness/samples/kb-remittance-reminder-memo.txt",
    name: "kb-remittance-reminder-memo.txt",
    type: "text/plain",
    group: "knowledge",
  },
];
