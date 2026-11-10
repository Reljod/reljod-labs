import { type DocumentKind, kindLabel } from "./document-kinds";
import { RULEBOOK } from "./rulebook";
import { documentsOf, firstOf, type RunState, text } from "./run-state";

/** Something a Job needs before it can run: any one of these kinds of Document. */
export type Want = { kinds: DocumentKind[]; why: string };

export const JOB_IDS = [
  "sort",
  "read",
  "match_identity",
  "check_eligibility",
  "verify_payee",
  "screen",
  "adjudicate",
  "verify_entity",
  "check_census",
  "reconcile",
  "map_ownership",
  "rate_risk",
  "decide",
] as const;

export type JobId = (typeof JOB_IDS)[number];

export type JobSpec = {
  title: string;
  /** What the Specialist is doing, shown while it runs. */
  doing: string;
  /** For MCP clients: what the Job does, what it needs and what it gives back. */
  description: string;
  /** Jobs whose output this one reads; planning adds them when missing. */
  after: JobId[];
  /** Model purpose it calls, if any (see model-config). */
  model?: "sort" | "read" | "adjudicate" | "decide";
  /** What it needs from the Cabinet, given what the Run knows so far. */
  needs: (state: RunState) => Want[];
};

const has = (state: RunState, kind: DocumentKind) =>
  documentsOf(state, kind).length > 0;

const want = (why: string, ...kinds: DocumentKind[]): Want => ({ kinds, why });

/** Only the wants not met by a Document of one of their kinds. */
export function unmet(state: RunState, wants: Want[]) {
  return wants.filter((item) => !item.kinds.some((kind) => has(state, kind)));
}

export function describeWant(item: Want) {
  return item.kinds.map(kindLabel).join(" or ");
}

export const JOBS: Record<JobId, JobSpec> = {
  sort: {
    title: "Sort",
    doing: "Sorting documents",
    description:
      "Looks at each Document and decides what it is (withdrawal request, passport, trust deed, contribution schedule and 25 other kinds). Needs at least one Document.",
    after: [],
    model: "sort",
    needs: (state) =>
      state.documents.length === 0
        ? [want("there is nothing to sort yet", "withdrawal_request_form")]
        : [],
  },
  read: {
    title: "Read",
    doing: "Reading every page",
    description:
      "Parses each sorted Document (PDF text layer, OCR for scans and photos, CSV for spreadsheets) and extracts the fields its kind defines, each traced to where it sits on the page.",
    after: ["sort"],
    model: "read",
    needs: () => [],
  },
  match_identity: {
    title: "Match identity",
    doing: "Matching the ID to the record",
    description:
      "Compares the identity document with the record (member statement, request form, customer profile or register): name, date of birth, expiry and certification. Asks for a marriage certificate when only the surname differs.",
    after: ["read"],
    // Only a withdrawal cannot go on without an ID; elsewhere the IDs on file are checked as found.
    needs: (state) =>
      state.pipeline === "pension_withdrawal" || !state.pipeline
        ? [
            want("to confirm who this is", "identity_document"),
            want(
              "to compare the ID against",
              "member_statement",
              "withdrawal_request_form",
              "customer_profile",
            ),
          ]
        : [],
  },
  check_eligibility: {
    title: "Check the Act",
    doing: "Checking the withdrawal against the Act",
    description:
      "Applies the National Pensions Act withdrawal rules: purpose, Meridian status, M$50,000 property cap, balance, permitted lender, primary residence, earlier withdrawals repaid, and whether the property evidence agrees.",
    after: ["read"],
    needs: (state) => {
      const form = firstOf(state, "withdrawal_request_form");
      const type = text(form, "withdrawal_type");
      const wants = [
        want("to know what is being asked", "withdrawal_request_form"),
        want("to know the balance and earlier withdrawals", "member_statement"),
      ];
      if ((RULEBOOK.propertyPurposes as readonly string[]).includes(type)) {
        wants.push(
          want("to show the member is Meridian", "meridian_status_evidence"),
          type === "mortgage_reduction"
            ? want(
                "to evidence the mortgage",
                "mortgage_statement",
                "lender_letter",
              )
            : want(
                "to evidence the purchase",
                "sale_agreement",
                "land_registry_extract",
              ),
        );
      }
      return wants;
    },
  },
  verify_payee: {
    title: "Verify payee",
    doing: "Following the money",
    description:
      "Checks the money goes to the right place: the lender or the attorney's client account for property withdrawals, the member's own account otherwise, never a third party.",
    after: ["read"],
    needs: () => [
      want("to see the payment instruction", "withdrawal_request_form"),
    ],
  },
  screen: {
    title: "Screen",
    doing: "Screening every name",
    description:
      "Screens every person and company in the case (members, payees, directors, signatories, owners, controllers) against the sanctions, PEP and adverse media watchlist.",
    after: ["read"],
    needs: () => [],
  },
  adjudicate: {
    title: "Adjudicate hits",
    doing: "Weighing each hit",
    description:
      "Compares each screening hit with the customer on date of birth, nationality, aliases and identifiers, and disposes of it as a false positive (with a written discount reason), a true match or inconclusive.",
    after: ["read"],
    model: "adjudicate",
    needs: (state) =>
      has(state, "screening_alert")
        ? [
            want(
              "to compare the hits against",
              "customer_profile",
              "identity_document",
            ),
          ]
        : [],
  },
  verify_entity: {
    title: "Verify company",
    doing: "Checking the company papers",
    description:
      "Checks the company's papers agree (name and number across the application, certificate and registers), the trade licence is in date and the signatories are authorised.",
    after: ["read"],
    needs: (state) => {
      // A contribution file from an employer already on the plan has no company papers to check.
      if (
        state.pipeline === "employer_onboarding" &&
        !has(state, "employer_application")
      ) {
        return [];
      }
      const wants = [
        want(
          "to confirm the company exists",
          "certificate_of_incorporation",
          "trust_deed",
        ),
      ];
      if (state.pipeline === "employer_onboarding") {
        wants.push(
          want(
            "to see who runs the company",
            "register_of_directors",
            "authorised_signatories",
          ),
        );
      }
      return wants;
    },
  },
  check_census: {
    title: "Check census",
    doing: "Checking the member census",
    description:
      "Validates an employer's member census: duplicates, impossible or out-of-range dates of birth, missing IDs and salaries.",
    after: ["read"],
    needs: (state) =>
      has(state, "contribution_schedule")
        ? []
        : [want("to enrol the staff", "member_census")],
  },
  reconcile: {
    title: "Reconcile",
    doing: "Reconciling contributions",
    description:
      "Recomputes every contribution line at 5% + 5% of pensionable earnings (capped at M$7,250 a month), checks each month was paid by the 15th, and totals arrears and late interest.",
    after: ["read"],
    needs: (state) =>
      has(state, "member_census") && !has(state, "contribution_schedule")
        ? []
        : [want("to reconcile", "contribution_schedule")],
  },
  map_ownership: {
    title: "Map ownership",
    doing: "Unwinding the structure",
    description:
      "Unwinds a company or trust to every natural person who owns 10% or more (multiplying through each layer) or controls it, and checks the registers add up.",
    after: ["read"],
    needs: () => [
      want(
        "to see who owns it",
        "register_of_members",
        "structure_chart",
        "trust_deed",
      ),
    ],
  },
  rate_risk: {
    title: "Rate risk",
    doing: "Rating the risk",
    description:
      "Scores the relationship low, standard or high from jurisdictions, structure depth, PEPs, screening, arrears and gaps, and says whether enhanced due diligence applies.",
    after: [],
    needs: () => [],
  },
  decide: {
    title: "Decision file",
    doing: "Writing the decision file",
    description:
      "Turns every check into a recommendation (approve, refer, decline or request information) and a one-page decision file with next steps.",
    after: [],
    model: "decide",
    needs: () => [],
  },
};

export function isJobId(value: string): value is JobId {
  return (JOB_IDS as readonly string[]).includes(value);
}

/** A job plus every job it depends on, in a runnable order. */
export function planJobs(requested: JobId[]): JobId[] {
  const ordered: JobId[] = [];
  const visit = (id: JobId) => {
    if (ordered.includes(id)) return;
    for (const dependency of JOBS[id].after) visit(dependency);
    ordered.push(id);
  };
  for (const id of requested) visit(id);
  return ordered;
}
