import {
  type AppliedRule,
  type CertificationPart,
  type MismatchOutcome,
  resolveRulebook,
} from "./rules";

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

/**
 * The Requirements a Pre-screen applies and the values its checks read,
 * resolved from the Owner's Rules (`resolveRulebook` in `rules.ts`).
 */
export type Rulebook = {
  id: string;
  version: string;
  title: string;
  jurisdiction: string;
  /** Readings below this confidence can only produce `needs_review`. */
  minFieldConfidence: number;
  /** Days an identity document must still be valid after the Pre-screen date. */
  identityMinValidityDays: number;
  /** Oldest a proof of address may be, in calendar months before the Pre-screen date. */
  proofOfAddressMaxAgeMonths: number;
  nameMismatchOutcome: MismatchOutcome;
  dateOfBirthMismatchOutcome: MismatchOutcome;
  addressMismatchOutcome: MismatchOutcome;
  /** What a certified copy must carry. */
  certificationParts: CertificationPart[];
  /** The Requirements switched on, in order. */
  requirements: Requirement[];
  /** Every Rule's Version and state, as the run applies it. */
  applied: AppliedRule[];
};

/** The Rulebook with every Rule at its Default. */
export const individualOnboarding: Rulebook = resolveRulebook({});

export function isRequirementId(value: unknown): value is RequirementId {
  return (
    typeof value === "string" &&
    (REQUIREMENT_IDS as readonly string[]).includes(value)
  );
}
