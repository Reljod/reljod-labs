/**
 * The demo's rules, after the Cayman Islands National Pensions Act as amended
 * in 2023. Simplified for the demo: confirm against the current Act and the
 * Department of Labour and Pensions guidance before relying on any figure.
 */
export const RULEBOOK = {
  name: "Cayman pensions and onboarding, demo edition",
  /** Home purchase, construction or mortgage reduction. */
  propertyWithdrawalCap: 50_000,
  propertyPurposes: ["property_purchase", "mortgage_reduction"],
  earlyRetirementAge: 60,
  permittedLenderTypes: [
    "class_a_bank",
    "building_society",
    "credit_union",
    "development_bank",
  ],
  /** 10% of pensionable earnings, half from each side. */
  employeeRate: 0.05,
  employerRate: 0.05,
  /** CI$87,000 a year. */
  monthlyEarningsCap: 7_250,
  /** Contributions are due by this day of the following month. */
  dueDay: 15,
  /** Interest on late contributions: prime plus 5%. Prime is fixed for the demo. */
  lateInterestRate: 0.0825 + 0.05,
  /** Beneficial ownership threshold for AML purposes. */
  uboThreshold: 10,
  /** ID certifications older than this need a fresh one. */
  certificationMaxAgeDays: 183,
  /** Rounding tolerance when comparing contributions, CI$. */
  centsTolerance: 0.05,
} as const;
