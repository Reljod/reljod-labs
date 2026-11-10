export type Requirement = {
  id: RequirementId;
  title: string;
};

export const REQUIREMENT_IDS = [
  "identity-document-present",
  "identity-document-not-expired",
  "proof-of-address-present",
  "proof-of-address-recent",
  "name-matches",
  "date-of-birth-matches",
  "address-matches",
  "certification-complete",
  "documents-legible",
  "no-tampering",
] as const;

export type RequirementId = (typeof REQUIREMENT_IDS)[number];

export type Rulebook = {
  id: string;
  version: string;
  title: string;
  jurisdiction: string;
  /** Oldest a proof of address may be, in calendar months before the Pre-screen date. */
  proofOfAddressMaxAgeMonths: number;
  /** Readings below this confidence can only produce `needs_review`. */
  minFieldConfidence: number;
  requirements: Requirement[];
};

export const individualOnboarding: Rulebook = {
  id: "individual-onboarding",
  version: "1",
  title: "Individual onboarding",
  jurisdiction: "Meridian AML/CFT customer due diligence",
  proofOfAddressMaxAgeMonths: 3,
  minFieldConfidence: 0.6,
  requirements: [
    {
      id: "identity-document-present",
      title: "Identity document is present",
    },
    {
      id: "identity-document-not-expired",
      title: "Identity document has not expired",
    },
    {
      id: "proof-of-address-present",
      title: "Proof of address is present",
    },
    {
      id: "proof-of-address-recent",
      title: "Proof of address is dated within 3 months",
    },
    { id: "name-matches", title: "Name matches across all documents" },
    {
      id: "date-of-birth-matches",
      title: "Date of birth matches across documents",
    },
    {
      id: "address-matches",
      title: "Address matches the declared address",
    },
    {
      id: "certification-complete",
      title: "Certified copy has a complete certification",
    },
    { id: "documents-legible", title: "Every document is legible" },
    { id: "no-tampering", title: "No document shows signs of tampering" },
  ],
};
