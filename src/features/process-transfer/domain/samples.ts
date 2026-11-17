/** A sample Recording a visitor can convert without uploading their own. */
export type Sample = {
  slug: string;
  title: string;
  /** One sentence: what is handed over on the call. */
  summary: string;
  /** The desk the Process belongs to. */
  team: string;
  presenter: string;
  receiver: string;
  durationSeconds: number;
  bytes: number;
  /** Public paths, served from `public/process-transfer/samples/`. */
  video: string;
  poster: string;
};

type Rendered = Pick<
  Sample,
  "presenter" | "receiver" | "durationSeconds" | "bytes"
>;

const sample = (
  slug: string,
  title: string,
  team: string,
  summary: string,
  rendered: Rendered,
): Sample => ({
  slug,
  title,
  summary,
  team,
  ...rendered,
  video: `/process-transfer/samples/${slug}.mp4`,
  poster: `/process-transfer/samples/${slug}.jpg`,
});

/** Durations and sizes as rendered by `pnpm render:process-transfer-samples`; update them after a re-render. */
export const SAMPLES: Sample[] = [
  sample(
    "contribution-reconciliation",
    "Month-end contribution reconciliation",
    "Pensions operations",
    "Matching an employer's remittance to its contribution schedule and posting it.",
    {
      presenter: "Corinne Ashdown",
      receiver: "Tomas Reyner",
      durationSeconds: 110,
      bytes: 2331434,
    },
  ),
  sample(
    "dormant-account-reactivation",
    "Reactivating a dormant account",
    "Branch operations",
    "Re-checking identity and lifting the dormancy flag with a supervisor's approval.",
    {
      presenter: "Delphine Marrow",
      receiver: "Joel Okafor-Lind",
      durationSeconds: 96,
      bytes: 1964753,
    },
  ),
  sample(
    "wire-recall",
    "Recalling an outgoing wire",
    "Payments",
    "Finding a sent payment, sending the recall message and logging the case.",
    {
      presenter: "Rafael Quintero",
      receiver: "Priya Castellane",
      durationSeconds: 95,
      bytes: 1757783,
    },
  ),
  sample(
    "employer-onboarding",
    "Onboarding a new employer",
    "Pensions operations",
    "Creating the employer record, setting contribution rates and sending the welcome pack.",
    {
      presenter: "Halima Strand",
      receiver: "Owen Tregarth",
      durationSeconds: 103,
      bytes: 1992198,
    },
  ),
  sample(
    "chargeback-dispute",
    "Handling a chargeback dispute",
    "Cards",
    "Opening a dispute case, giving provisional credit and tracking the evidence deadline.",
    {
      presenter: "Marcus Bellweather",
      receiver: "Ana Lucia Ferro",
      durationSeconds: 88,
      bytes: 1612290,
    },
  ),
  sample(
    "nostro-break",
    "Investigating a nostro break",
    "Treasury operations",
    "Tracing an unmatched item on the nostro reconciliation and clearing it.",
    {
      presenter: "Ingrid Solberg-Ade",
      receiver: "Kenji Abernathy",
      durationSeconds: 117,
      bytes: 2381984,
    },
  ),
  sample(
    "kyc-periodic-review",
    "KYC periodic review",
    "Compliance",
    "Working the due list: refreshing documents, re-scoring risk and escalating.",
    {
      presenter: "Femi Adeyemi-Clarke",
      receiver: "Rosa Linwood",
      durationSeconds: 109,
      bytes: 2046236,
    },
  ),
  sample(
    "returned-cheque",
    "Processing a returned cheque",
    "Clearing",
    "Reversing the credit, charging the fee and telling the customer.",
    {
      presenter: "Margot Pellew",
      receiver: "Samira Achterberg",
      durationSeconds: 118,
      bytes: 2449525,
    },
  ),
  sample(
    "standing-order-change",
    "Amending a standing order",
    "Payments",
    "Checking the mandate and changing a standing order under dual approval.",
    {
      presenter: "Theo Vantongeren",
      receiver: "Grace Imbali-Rowe",
      durationSeconds: 107,
      bytes: 2185982,
    },
  ),
  sample(
    "sanctions-alert",
    "Dispositioning a sanctions alert",
    "Compliance",
    "Comparing an alert against the customer and recording the rationale.",
    {
      presenter: "Nadia Corvell",
      receiver: "Arjun Pellegrini",
      durationSeconds: 117,
      bytes: 2120270,
    },
  ),
  sample(
    "fee-refund",
    "Approving a fee refund",
    "Customer care",
    "Checking eligibility and authority limits, then posting the refund.",
    {
      presenter: "Lorna Quayle",
      receiver: "Dev Okonjo-Hart",
      durationSeconds: 88,
      bytes: 1666293,
    },
  ),
  sample(
    "user-access-request",
    "Provisioning system access",
    "IT security",
    "Granting core-banking access against the role matrix and duty checks.",
    {
      presenter: "Victor Halloran",
      receiver: "Ruben Arkwright",
      durationSeconds: 92,
      bytes: 1927018,
    },
  ),
];

export function sampleBySlug(slug: string): Sample | undefined {
  return SAMPLES.find((item) => item.slug === slug);
}
