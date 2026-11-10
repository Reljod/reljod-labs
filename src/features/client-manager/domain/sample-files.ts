/**
 * Synthetic client files served from `public/client-manager/samples/`, for
 * dragging into the Intake form. Sources live in `fixtures/client-manager/`;
 * regenerate with `pnpm render:client-manager-samples` and update `size` if a
 * file changes. Every party is fictional (Republic of Meridia, M$).
 */
export const SAMPLE_FILES: {
  client: string;
  name: string;
  path: string;
  kind: "pdf" | "sheet";
  size: number;
  description: string;
}[] = [
  {
    client: "Rafael Okoro",
    name: "brokerage-statement.pdf",
    path: "/client-manager/samples/rafael-okoro/brokerage-statement.pdf",
    kind: "pdf",
    size: 64901,
    description:
      "Northgate Securities Q3 2026 statement: holdings, restricted Lumen Freight shares, cash history",
  },
  {
    client: "Rafael Okoro",
    name: "cap-table-summary.pdf",
    path: "/client-manager/samples/rafael-okoro/cap-table-summary.pdf",
    kind: "pdf",
    size: 69022,
    description:
      "Lumen Freight cap table after the Series C: his 22% stake, vesting, lock-up and Okoro Ventures Ltd",
  },
  {
    client: "Rafael Okoro",
    name: "mortgage-statement.pdf",
    path: "/client-manager/samples/rafael-okoro/mortgage-statement.pdf",
    kind: "pdf",
    size: 63353,
    description:
      "Halvard Building Society mortgage on the Kestrel Heights home, joint with Ada",
  },
  {
    client: "Rafael Okoro",
    name: "life-insurance-policy.pdf",
    path: "/client-manager/samples/rafael-okoro/life-insurance-policy.pdf",
    kind: "pdf",
    size: 62015,
    description:
      "Corvane Life policy schedule: M$8M term cover, critical illness, beneficiaries",
  },
  {
    client: "Rafael Okoro",
    name: "angel-portfolio.xlsx",
    path: "/client-manager/samples/rafael-okoro/angel-portfolio.xlsx",
    kind: "sheet",
    size: 4212,
    description:
      "Okoro Ventures Ltd workbook of four angel investments, including Pallas Bio",
  },
  {
    client: "Elena Marsh",
    name: "private-bank-statement.pdf",
    path: "/client-manager/samples/elena-marsh/private-bank-statement.pdf",
    kind: "pdf",
    size: 67443,
    description:
      "Calder Private Bank Q3 2026 statement: deposits, term deposits, joint accounts now in her name",
  },
  {
    client: "Elena Marsh",
    name: "share-sale-completion.pdf",
    path: "/client-manager/samples/elena-marsh/share-sale-completion.pdf",
    kind: "pdf",
    size: 54523,
    description:
      "Marsh Dynamics share sale completion statement: buyer, price, escrow and earn-out",
  },
  {
    client: "Elena Marsh",
    name: "property-schedule.pdf",
    path: "/client-manager/samples/elena-marsh/property-schedule.pdf",
    kind: "pdf",
    size: 51209,
    description:
      "Nair & Cole schedule of the Henlow home, Saltmere cottage, mooring and yacht",
  },
  {
    client: "Elena Marsh",
    name: "estate-letter.pdf",
    path: "/client-manager/samples/elena-marsh/estate-letter.pdf",
    kind: "pdf",
    size: 60474,
    description:
      "Letter from Priya Nair on Daniel's estate: executors, legacies, tax and next steps",
  },
];
