/**
 * Every kind of Document the Specialist can sort, and the fields its Read job
 * pulls from each. This is also the label contract for the synthetic Cabinet:
 * each fixture Document's `label` uses exactly these field names and types.
 *
 * Types: `text` and `date` (ISO `YYYY-MM-DD`) are strings, `money` is a number
 * in Cayman Islands dollars (CI$), `flag` is a boolean, `list` holds objects
 * with the listed item fields, `names` is an array of full names.
 */

export type FieldType = "text" | "date" | "money" | "number" | "flag" | "names";

export type FieldSpec =
  | { type: FieldType; hint: string }
  | {
      type: "list";
      hint: string;
      item: Record<string, { type: FieldType; hint: string }>;
    };

export type DocumentKindSpec = {
  label: string;
  /** What it looks like, so sorting can tell it from its neighbours. */
  looksLike: string;
  fields: Record<string, FieldSpec>;
};

const t = (hint: string) => ({ type: "text" as const, hint });
const d = (hint: string) => ({ type: "date" as const, hint });
const m = (hint: string) => ({ type: "money" as const, hint });
const n = (hint: string) => ({ type: "number" as const, hint });
const f = (hint: string) => ({ type: "flag" as const, hint });
const names = (hint: string) => ({ type: "names" as const, hint });

export const DOCUMENT_KINDS = {
  // Pension withdrawals ------------------------------------------------------
  withdrawal_request_form: {
    label: "Withdrawal request",
    looksLike:
      "A pension plan's member form asking to withdraw funds, with member details, withdrawal type, amount, payee and signature",
    fields: {
      member_name: t("member's full name as written"),
      member_number: t("pension plan member number"),
      date_of_birth: d("member's date of birth"),
      withdrawal_type: t(
        "one of property_purchase, mortgage_reduction, early_retirement, other",
      ),
      amount_requested: m("amount requested in CI$"),
      property_address: t("address of the property, if any"),
      payee_name: t("name of the account the funds are to be paid to"),
      payee_bank: t("bank of the payee account"),
      payee_account_number: t("payee account number"),
      caymanian_status_declared: f("member ticks that they are Caymanian"),
      primary_residence_declared: f(
        "member declares the property is or will be their primary residence",
      ),
      signature_present: f("the member's signature is present"),
      signed_date: d("date the form was signed"),
    },
  },
  member_statement: {
    label: "Member statement",
    looksLike:
      "A pension plan statement for one member with balances, contributions and any prior withdrawals",
    fields: {
      member_name: t("member's full name"),
      member_number: t("pension plan member number"),
      date_of_birth: d("member's date of birth"),
      employer_name: t("current participating employer"),
      statement_date: d("statement date"),
      total_balance: m("total account balance in CI$"),
      prior_property_withdrawals: m(
        "total of earlier property withdrawals in CI$, 0 if none",
      ),
      prior_withdrawals_repaid: f(
        "earlier property withdrawals are repaid or being repaid on schedule; true when there are none",
      ),
    },
  },
  identity_document: {
    label: "Identity document",
    looksLike:
      "A passport data page, driver's licence or voter's card, often a certified copy with a certifier's stamp",
    fields: {
      document_type: t("passport, drivers_licence or voter_card"),
      full_name: t("holder's full name"),
      date_of_birth: d("holder's date of birth"),
      nationality: t("holder's nationality"),
      id_number: t("document number"),
      date_of_expiry: d("expiry date"),
      certified: f("carries a certification that it is a true copy"),
      certifier_name: t("certifier's name, if certified"),
      certifier_occupation: t("certifier's occupation, if certified"),
      certification_date: d("date certified, if certified"),
    },
  },
  caymanian_status_evidence: {
    label: "Caymanian status evidence",
    looksLike:
      "A certificate of Caymanian status, a Cayman Islands birth certificate or a Caymanian passport endorsement",
    fields: {
      full_name: t("person's full name"),
      date_of_birth: d("date of birth"),
      status_basis: t("birth, descent, marriage, grant or other basis"),
      document_number: t("certificate or registration number"),
      issue_date: d("date issued"),
    },
  },
  marriage_certificate: {
    label: "Marriage certificate",
    looksLike: "A certified copy of an entry of marriage",
    fields: {
      party_one_name: t("first party's name before marriage"),
      party_two_name: t("second party's name before marriage"),
      date_of_marriage: d("date of marriage"),
      certificate_number: t("registration or certificate number"),
    },
  },
  sale_agreement: {
    label: "Sale agreement",
    looksLike:
      "An agreement for sale and purchase of land in the Cayman Islands naming vendor, purchaser, parcel and price",
    fields: {
      purchaser_names: names("purchasers"),
      vendor_names: names("vendors"),
      property_address: t("property address"),
      block_parcel: t(
        "registration section, block and parcel, e.g. West Bay Beach North Block 11D Parcel 92",
      ),
      purchase_price: m("purchase price in CI$"),
      deposit: m("deposit in CI$"),
      completion_date: d("agreed completion date"),
    },
  },
  land_registry_extract: {
    label: "Land register extract",
    looksLike:
      "A Cayman Islands Land Registry extract or register of title for one parcel, with proprietors and charges",
    fields: {
      block_parcel: t("block and parcel"),
      property_address: t("address or description of the land"),
      registered_proprietors: names("registered proprietors"),
      charge_holder: t("lender holding a charge over the parcel, if any"),
      extract_date: d("date of the extract"),
    },
  },
  mortgage_statement: {
    label: "Mortgage statement",
    looksLike:
      "A lender's statement for a residential mortgage with outstanding balance and borrower details",
    fields: {
      borrower_names: names("borrowers"),
      lender_name: t("lender"),
      loan_account_number: t("loan account number"),
      outstanding_balance: m("outstanding balance in CI$"),
      property_address: t("mortgaged property address"),
      statement_date: d("statement date"),
    },
  },
  lender_letter: {
    label: "Lender letter",
    looksLike:
      "A letter from a bank, building society or credit union: mortgage commitment, approval or payoff instruction",
    fields: {
      lender_name: t("lender"),
      lender_type: t(
        "class_a_bank, building_society, credit_union, development_bank or private_lender",
      ),
      borrower_names: names("borrowers"),
      property_address: t("property address"),
      amount: m("loan or payment amount in CI$"),
      letter_date: d("letter date"),
    },
  },
  attorney_letter: {
    label: "Attorney's letter",
    looksLike:
      "An attorney-at-law's undertaking letter about a property transaction with client account details",
    fields: {
      firm_name: t("law firm"),
      attorney_name: t("attorney who signed"),
      client_names: names("the attorney's clients"),
      client_account_name: t("name of the firm's client account"),
      client_account_number: t("client account number"),
      bank_name: t("bank holding the client account"),
      property_address: t("property address"),
      letter_date: d("letter date"),
    },
  },
  bank_letter: {
    label: "Bank confirmation",
    looksLike:
      "A bank's letter confirming who holds an account, used to verify where money is paid",
    fields: {
      account_holder: t("account holder's name"),
      bank_name: t("bank"),
      account_number: t("account number"),
      letter_date: d("letter date"),
    },
  },

  // Employers ----------------------------------------------------------------
  employer_application: {
    label: "Employer application",
    looksLike:
      "A participating employer application or participation agreement for a multi-employer pension plan",
    fields: {
      employer_name: t("employer's legal name"),
      registration_number: t("company registration number"),
      trade_name: t("trading name, if different"),
      business_address: t("business address"),
      nature_of_business: t("what the business does"),
      employee_count: n("number of employees declared"),
      contact_name: t("HR or payroll contact"),
      signatory_names: names("people who signed for the employer"),
      signed_date: d("date signed"),
    },
  },
  certificate_of_incorporation: {
    label: "Certificate of incorporation",
    looksLike:
      "A Registrar of Companies certificate of incorporation or registration for a company or partnership",
    fields: {
      entity_name: t("company name"),
      registration_number: t("registration number"),
      jurisdiction: t("place of incorporation"),
      entity_type: t(
        "ordinary resident, exempted, LLC, foreign, partnership, etc.",
      ),
      incorporation_date: d("date of incorporation"),
    },
  },
  trade_business_licence: {
    label: "Trade & business licence",
    looksLike:
      "A Cayman Islands trade and business licence naming the licensee, activity and expiry",
    fields: {
      licensee_name: t("licensee"),
      licence_number: t("licence number"),
      business_activity: t("licensed activity"),
      expiry_date: d("expiry date"),
    },
  },
  register_of_directors: {
    label: "Register of directors",
    looksLike:
      "A company's register of directors and officers, or a certificate of incumbency",
    fields: {
      entity_name: t("company name"),
      as_of_date: d("date of the register or certificate"),
      directors: {
        type: "list",
        hint: "every director or officer listed",
        item: {
          name: t("full name"),
          role: t("director, secretary, alternate, officer"),
          date_of_birth: d("date of birth, if shown"),
          nationality: t("nationality, if shown"),
          appointed: d("date appointed, if shown"),
        },
      },
    },
  },
  authorised_signatories: {
    label: "Board resolution",
    looksLike:
      "A board resolution or mandate naming authorised signatories for the plan or an account",
    fields: {
      entity_name: t("company name"),
      resolution_date: d("date of the resolution"),
      signatories: {
        type: "list",
        hint: "each authorised signatory",
        item: { name: t("full name"), title: t("title or role") },
      },
    },
  },
  member_census: {
    label: "Member census",
    looksLike:
      "A spreadsheet of an employer's staff for pension enrolment: names, dates of birth, hire dates, salaries",
    fields: {
      employer_name: t("employer, if stated"),
      members: {
        type: "list",
        hint: "each employee row",
        item: {
          employee_id: t("employee id"),
          full_name: t("employee name"),
          date_of_birth: d("date of birth"),
          hire_date: d("hire date"),
          monthly_salary: m("monthly gross salary in CI$"),
          id_number: t("ID or passport number"),
        },
      },
    },
  },
  contribution_schedule: {
    label: "Contribution schedule",
    looksLike:
      "A payroll remittance schedule listing each employee's pension contributions for one or more months",
    fields: {
      employer_name: t("employer, if stated"),
      lines: {
        type: "list",
        hint: "each employee line for each month",
        item: {
          period: t("contribution month as YYYY-MM"),
          employee_id: t("employee id"),
          full_name: t("employee name"),
          gross_earnings: m("gross earnings for the month in CI$"),
          employee_contribution: m("employee contribution in CI$"),
          employer_contribution: m("employer contribution in CI$"),
          date_paid: d("date the money reached the plan; empty if unpaid"),
        },
      },
    },
  },
  remittance_advice: {
    label: "Remittance advice",
    looksLike:
      "A bank payment confirmation or remittance advice for a pension contribution transfer",
    fields: {
      payer_name: t("who paid"),
      amount: m("amount paid in CI$"),
      value_date: d("value date"),
      reference: t("payment reference"),
      period: t("contribution month it covers as YYYY-MM"),
    },
  },

  // Structures ---------------------------------------------------------------
  trust_deed: {
    label: "Trust deed",
    looksLike:
      "A deed declaring or settling a trust, naming settlor, trustees, protector and beneficiaries",
    fields: {
      trust_name: t("name of the trust"),
      deed_date: d("date of the deed"),
      governing_law: t("governing law"),
      trust_type: t("discretionary, fixed_interest, purpose, STAR or other"),
      settlor_names: names("settlors"),
      trustee_names: names("trustees"),
      protector_names: names("protectors, if any"),
      beneficiary_names: names("named beneficiaries"),
      beneficiary_class: t("class of beneficiaries described, if any"),
    },
  },
  deed_of_appointment: {
    label: "Deed of appointment",
    looksLike:
      "A deed appointing or removing trustees or protectors, or adding beneficiaries",
    fields: {
      trust_name: t("trust"),
      deed_date: d("date"),
      role: t("trustee, protector or beneficiary"),
      appointed_names: names("people or companies appointed or added"),
      removed_names: names("people or companies removed"),
    },
  },
  letter_of_wishes: {
    label: "Letter of wishes",
    looksLike: "A settlor's non-binding letter to the trustees",
    fields: {
      author_name: t("who wrote it"),
      letter_date: d("date"),
      named_persons: names("people it names as intended recipients"),
    },
  },
  register_of_members: {
    label: "Register of members",
    looksLike:
      "A company's register of members or shareholders with share counts and classes",
    fields: {
      entity_name: t("company name"),
      as_of_date: d("date of the register"),
      members: {
        type: "list",
        hint: "each shareholder entry",
        item: {
          holder_name: t("shareholder"),
          holder_type: t("individual, company, trust or nominee"),
          shares: n("number of shares"),
          share_class: t("share class"),
          percentage: n("percentage of issued shares, 0-100"),
        },
      },
    },
  },
  structure_chart: {
    label: "Structure chart",
    looksLike:
      "A diagram of entities and people with arrows and ownership percentages",
    fields: {
      top_entity: t("the entity being onboarded"),
      links: {
        type: "list",
        hint: "each ownership or control arrow",
        item: {
          owner: t("who owns or controls"),
          owned: t("what is owned or controlled"),
          percentage: n("percentage, 0-100; 0 for control without ownership"),
          relation: t(
            "shareholding, trustee_of, settlor_of, protector_of, director_of",
          ),
        },
      },
    },
  },
  source_of_wealth: {
    label: "Source of wealth",
    looksLike:
      "A declaration or adviser's memo describing how a person built their wealth",
    fields: {
      person_name: t("whose wealth"),
      declared_sources: t("the sources, comma separated"),
      estimated_net_worth: m(
        "estimated net worth in CI$ (convert US$ at 0.82 if needed)",
      ),
      corroborated: f("evidence is attached or cited for the main source"),
      declaration_date: d("date"),
    },
  },

  // Screening ----------------------------------------------------------------
  screening_alert: {
    label: "Screening alert",
    looksLike:
      "A watchlist screening system alert listing potential matches for one customer with scores",
    fields: {
      alert_id: t("alert reference"),
      customer_name: t("screened customer name"),
      customer_id: t("customer id"),
      screened_on: d("screening date"),
      hits: {
        type: "list",
        hint: "each potential match",
        item: {
          hit_name: t("name on the list"),
          list_type: t("sanctions, pep or adverse_media"),
          list_source: t("list or source name"),
          match_score: n("score 0-100"),
          hit_date_of_birth: t("date or year of birth on the list, as shown"),
          hit_nationality: t("nationality on the list"),
          hit_reference: t("list entry reference"),
        },
      },
    },
  },
  customer_profile: {
    label: "Customer profile",
    looksLike:
      "A KYC record printout for an existing client: name, date of birth, nationality, residence, occupation, IDs",
    fields: {
      customer_name: t("customer name"),
      customer_id: t("customer id"),
      date_of_birth: d("date of birth"),
      nationality: t("nationality"),
      residence: t("country of residence"),
      occupation: t("occupation"),
      id_number: t("primary ID number"),
      other_names: names("aliases, former or maiden names"),
    },
  },
  watchlist_entry: {
    label: "Watchlist entry",
    looksLike:
      "A detail page for one sanctions, PEP or watchlist record with identifiers",
    fields: {
      entry_name: t("listed name"),
      aliases: names("aliases"),
      date_of_birth: t("date or year of birth, as shown"),
      place_of_birth: t("place of birth"),
      nationality: t("nationality"),
      list_source: t("list name"),
      listing_reason: t("why listed, or the public role for a PEP"),
      reference: t("entry reference"),
    },
  },
  adverse_media_article: {
    label: "News article",
    looksLike: "A news clipping or web article about a named person",
    fields: {
      headline: t("headline"),
      publication: t("publication"),
      published_date: d("publication date"),
      subject_name: t("person the article is about"),
      subject_age_or_dob: t("age or date of birth given for them"),
      subject_location: t("where they live or work per the article"),
      allegation: t("what is alleged, in a few words"),
    },
  },
} satisfies Record<string, DocumentKindSpec>;

export type DocumentKind = keyof typeof DOCUMENT_KINDS;

export const DOCUMENT_KIND_IDS = Object.keys(DOCUMENT_KINDS) as DocumentKind[];

export function isDocumentKind(value: string): value is DocumentKind {
  return value in DOCUMENT_KINDS;
}

export function kindLabel(kind: string) {
  return isDocumentKind(kind) ? DOCUMENT_KINDS[kind].label : "Unsorted";
}
