/**
 * The fixed part of the fictional Harbour Bank & Trust pension plan: its
 * Employers, its Members and the Schedule lines the sample files carry.
 * Dates are not here: `seed-data.ts` lays them out relative to the day a
 * Workspace is seeded, so the demo stays current.
 *
 * Every company and person is invented; e-mail addresses use the reserved
 * `.example` domain. This file has no runtime imports, so the script that
 * writes the sample files (`scripts/build-harness-samples.mts`) can load it
 * with Node alone.
 */

export type Residency = "caymanian" | "permanent_resident" | "work_permit";

export type RosterEmployer = {
  code: string;
  name: string;
  contactEmail: string;
  /** Years in the plan, for `joinedOn`. */
  yearsInPlan: number;
  /** What the latest month holds for it, for the demo's story. */
  story: string;
};

export type RosterMember = {
  memberNo: string;
  fullName: string;
  employerCode: string | null;
  age: number;
  nationality: string;
  residency: Residency;
  monthlyEarningsKyd: number;
  balanceKyd: number;
  voluntaryKyd: number;
  status: "active" | "inactive" | "deferred" | "retired" | "closed";
  /** Months since starting work in the Islands; null for Caymanians and residents. */
  startedMonthsAgo: number | null;
  /** The case this Member is built for, if any. */
  role:
    | "overseas-eligible"
    | "overseas-too-soon"
    | "transfer-out"
    | "property"
    | "retirement"
    | "nine-month"
    | "high-earner"
    | "retired"
    | "closed"
    | null;
};

export const ROSTER_EMPLOYERS: RosterEmployer[] = [
  {
    code: "ER-1001",
    name: "Pelican Shoal Marine Services Ltd",
    contactEmail: "payroll@pelicanshoal.example",
    yearsInPlan: 11,
    story: "Pays in full and on time; its Schedule is the clean sample.",
  },
  {
    code: "ER-1002",
    name: "Wrayfield Hospitality Group Ltd",
    contactEmail: "accounts@wrayfield.example",
    yearsInPlan: 8,
    story: "Paid the latest month late, on the 19th.",
  },
  {
    code: "ER-1003",
    name: "Brackwater Construction Ltd",
    contactEmail: "office@brackwater.example",
    yearsInPlan: 6,
    story: "Filed its latest Schedule but has not paid.",
  },
  {
    code: "ER-1004",
    name: "Lanternfish Dental Ltd",
    contactEmail: "practice@lanternfish.example",
    yearsInPlan: 4,
    story: "Paid the latest month short by CI$412.50.",
  },
  {
    code: "ER-1005",
    name: "Calloway Bight Logistics Ltd",
    contactEmail: "payroll@callowaybight.example",
    yearsInPlan: 3,
    story:
      "Pays the employer share at 4% and lists a person who is not a Member.",
  },
  {
    code: "ER-1006",
    name: "Tamarind Row Retail Ltd",
    contactEmail: "hr@tamarindrow.example",
    yearsInPlan: 9,
    story:
      "Clean, with a Member over 65, a new work-permit holder and a high earner.",
  },
];

type Row = [
  name: string,
  employer: string | null,
  age: number,
  nationality: string,
  residency: Residency,
  earnings: number,
  balance: number,
  extra?: Partial<
    Pick<RosterMember, "voluntaryKyd" | "status" | "startedMonthsAgo" | "role">
  >,
];

const ROWS: Row[] = [
  // Pelican Shoal Marine Services: clean.
  [
    "Orrin Bascombe-Teal",
    "ER-1001",
    44,
    "Caymanian",
    "caymanian",
    6200,
    88410.22,
  ],
  [
    "Lysandra Quarrie-Holt",
    "ER-1001",
    31,
    "Jamaican",
    "work_permit",
    3900,
    21034.9,
  ],
  [
    "Tobiah Renwick",
    "ER-1001",
    52,
    "British",
    "permanent_resident",
    7100,
    132775.04,
  ],
  [
    "Marisol Ochoa-Vance",
    "ER-1001",
    27,
    "Honduran",
    "work_permit",
    2650,
    9212.37,
  ],
  [
    "Fenwick Daley-Amos",
    "ER-1001",
    38,
    "Caymanian",
    "caymanian",
    5400,
    47890.11,
  ],
  ["Priya Raghunathan", "ER-1001", 35, "Indian", "work_permit", 6800, 33118.59],
  [
    "Rochelle Tibbetts-Arden",
    "ER-1001",
    34,
    "Caymanian",
    "caymanian",
    4800,
    62004.75,
    { role: "property" },
  ],
  [
    "Kalani Mercer-Oduya",
    "ER-1001",
    29,
    "American",
    "work_permit",
    5100,
    14770,
    { voluntaryKyd: 100 },
  ],
  // Wrayfield Hospitality Group: paid late.
  [
    "Imelda Castillo-Reyes",
    "ER-1002",
    41,
    "Filipino",
    "work_permit",
    2300,
    18452.66,
  ],
  [
    "Barrington Coe-Whitlock",
    "ER-1002",
    47,
    "Caymanian",
    "caymanian",
    5900,
    96301.48,
  ],
  ["Sinead Halloran", "ER-1002", 33, "Irish", "work_permit", 4400, 19877.31],
  [
    "Rodel Manalastas",
    "ER-1002",
    39,
    "Filipino",
    "work_permit",
    2150,
    15640.02,
  ],
  [
    "Delphine Arceneaux-Bodie",
    "ER-1002",
    56,
    "Caymanian",
    "caymanian",
    6600,
    141220.9,
  ],
  ["Tremaine Fogarty", "ER-1002", 24, "Jamaican", "work_permit", 2400, 4310.55],
  [
    "Ottoline Varga-Sims",
    "ER-1002",
    45,
    "Canadian",
    "permanent_resident",
    7300,
    77064.13,
  ],
  [
    "Desmond Arbery-Lyle",
    "ER-1002",
    49,
    "Jamaican",
    "permanent_resident",
    6100,
    54230.18,
    { status: "inactive", role: "transfer-out" },
  ],
  // Brackwater Construction: unpaid.
  [
    "Cyprian Mullings-Goode",
    "ER-1003",
    36,
    "Jamaican",
    "work_permit",
    3600,
    22915.4,
  ],
  [
    "Esteban Murillo-Paz",
    "ER-1003",
    42,
    "Nicaraguan",
    "work_permit",
    3300,
    26388.71,
  ],
  [
    "Lorne Whittaker-Bush",
    "ER-1003",
    58,
    "Caymanian",
    "caymanian",
    6900,
    158402.36,
  ],
  [
    "Jasper Kincaid-Ruiz",
    "ER-1003",
    26,
    "Honduran",
    "work_permit",
    2800,
    7604.29,
  ],
  [
    "Hollis Brathwaite-Eden",
    "ER-1003",
    33,
    "Caymanian",
    "caymanian",
    4700,
    29330.84,
  ],
  [
    "Nkosana Dube-Farrell",
    "ER-1003",
    40,
    "South African",
    "work_permit",
    7600,
    41556.12,
  ],
  // Lanternfish Dental: paid short.
  [
    "Annika Sorensen-Pryce",
    "ER-1004",
    46,
    "British",
    "permanent_resident",
    9800,
    118909.47,
  ],
  [
    "Marguerite Ebdon-Kayle",
    "ER-1004",
    32,
    "Caymanian",
    "caymanian",
    3800,
    24105.66,
  ],
  [
    "Shavonne Petgrave-Lumb",
    "ER-1004",
    28,
    "Jamaican",
    "work_permit",
    3100,
    8870.03,
  ],
  ["Ilse Brandvold", "ER-1004", 37, "Canadian", "work_permit", 5600, 20214.18],
  [
    "Corliss Ainsley-Rhoden",
    "ER-1004",
    51,
    "Caymanian",
    "caymanian",
    4300,
    83640.25,
  ],
  // Calloway Bight Logistics: wrong rate and a stranger on the Schedule.
  [
    "Augustin Lemaire-Doyle",
    "ER-1005",
    43,
    "Irish",
    "work_permit",
    4500,
    25610.49,
  ],
  [
    "Rafferty Okonjo-Hale",
    "ER-1005",
    30,
    "British",
    "work_permit",
    3950,
    11330.17,
  ],
  [
    "Yesenia Paredes-Lowe",
    "ER-1005",
    35,
    "Honduran",
    "work_permit",
    2600,
    12407.88,
  ],
  [
    "Ignatius Bramwell-Fox",
    "ER-1005",
    54,
    "Caymanian",
    "caymanian",
    6300,
    121775.3,
  ],
  [
    "Thandiwe Mokoena-Price",
    "ER-1005",
    39,
    "South African",
    "work_permit",
    5200,
    23018.64,
  ],
  [
    "Linnea Strand-Okafor",
    "ER-1005",
    27,
    "American",
    "work_permit",
    4100,
    6912.2,
  ],
  // Tamarind Row Retail: clean, with edge cases for coverage and the cap.
  [
    "Cuthbert Lindqvist-Mora",
    "ER-1006",
    66,
    "Caymanian",
    "caymanian",
    4100,
    205388.62,
    { role: "retirement" },
  ],
  [
    "Teresita Villanueva-Ocampo",
    "ER-1006",
    33,
    "Filipino",
    "work_permit",
    2350,
    940,
    { startedMonthsAgo: 4, role: "nine-month" },
  ],
  [
    "Fitzgerald Arch-Bowen",
    "ER-1006",
    49,
    "Caymanian",
    "caymanian",
    11500,
    176050.91,
    { role: "high-earner" },
  ],
  [
    "Natalya Orlov-Briggs",
    "ER-1006",
    38,
    "Canadian",
    "permanent_resident",
    5000,
    39402.77,
  ],
  ["Seamus Dunleavy", "ER-1006", 25, "Irish", "work_permit", 2900, 5118.46],
  ["Anjali Menon-Ward", "ER-1006", 42, "Indian", "work_permit", 4600, 28734.05],
  [
    "Rupert Castellanos-Hay",
    "ER-1006",
    60,
    "Caymanian",
    "caymanian",
    5200,
    133947.19,
  ],
  [
    "Glenys Pryor-Ambrose",
    "ER-1006",
    31,
    "Caymanian",
    "caymanian",
    3500,
    17225.38,
  ],
  // No longer working for an Employer in the plan.
  [
    "Alison Fairweather-Kent",
    null,
    47,
    "Canadian",
    "work_permit",
    0,
    38412.55,
    { status: "deferred", role: "overseas-eligible" },
  ],
  [
    "Gareth Penhallow",
    null,
    39,
    "British",
    "work_permit",
    0,
    21906.4,
    { status: "deferred", role: "overseas-too-soon" },
  ],
  [
    "Winifred Solomon-Gray",
    null,
    71,
    "Caymanian",
    "caymanian",
    0,
    0,
    { status: "retired", role: "retired" },
  ],
  [
    "Horatio Venn-Marsh",
    null,
    44,
    "British",
    "work_permit",
    0,
    0,
    { status: "closed", role: "closed" },
  ],
];

export const ROSTER_MEMBERS: RosterMember[] = ROWS.map(
  (
    [
      fullName,
      employerCode,
      age,
      nationality,
      residency,
      earnings,
      balance,
      extra,
    ],
    index,
  ) => ({
    memberNo: `HB-${10001 + index}`,
    fullName,
    employerCode,
    age,
    nationality,
    residency,
    monthlyEarningsKyd: earnings,
    balanceKyd: balance,
    voluntaryKyd: extra?.voluntaryKyd ?? 0,
    status: extra?.status ?? "active",
    startedMonthsAgo:
      extra?.startedMonthsAgo ??
      (residency === "work_permit" ? 18 + ((index * 7) % 70) : null),
    role: extra?.role ?? null,
  }),
);

export function rosterMember(
  role: NonNullable<RosterMember["role"]>,
): RosterMember {
  const member = ROSTER_MEMBERS.find((item) => item.role === role);
  if (!member) throw new Error(`No roster Member plays ${role}`);
  return member;
}

/** The Employer share Calloway Bight Logistics pays: 4%, not 5%. */
export const WRONG_EMPLOYER_RATE = 4;
/** The person Calloway Bight lists who is not a Member. */
export const STRANGER = {
  memberNo: "HB-19417",
  memberName: "Jonah Pettigrew-Saul",
  earningsKyd: 3200,
};
/** What Lanternfish Dental paid short in the latest month. */
export const SHORT_PAID_KYD = 412.5;
/** The yearly earnings cap, for the sample lines (`cp.ympe-cap`). */
export const ANNUAL_CAP_KYD = 87_000;

export type SampleLine = {
  memberNo: string;
  memberName: string;
  earningsKyd: number;
  employeeKyd: number;
  employerKyd: number;
  voluntaryKyd: number;
};

const cents = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** One line at the given rates, on earnings capped at a twelfth of the yearly maximum. */
export function lineFor(
  member: Pick<
    RosterMember,
    "memberNo" | "fullName" | "monthlyEarningsKyd" | "voluntaryKyd"
  >,
  employerRatePct = 5,
  employeeRatePct = 5,
): SampleLine {
  const base = cents(Math.min(member.monthlyEarningsKyd, ANNUAL_CAP_KYD / 12));
  return {
    memberNo: member.memberNo,
    memberName: member.fullName,
    earningsKyd: member.monthlyEarningsKyd,
    employeeKyd: cents((base * employeeRatePct) / 100),
    employerKyd: cents((base * employerRatePct) / 100),
    voluntaryKyd: member.voluntaryKyd,
  };
}

/** The lines an Employer's Schedule carries in an ordinary month: its active Members. */
export function ordinaryLines(employerCode: string): SampleLine[] {
  const members = ROSTER_MEMBERS.filter(
    (member) =>
      member.employerCode === employerCode && member.status === "active",
  );
  if (employerCode === "ER-1005") {
    return [
      ...members.map((member) => lineFor(member, WRONG_EMPLOYER_RATE)),
      lineFor(
        {
          memberNo: STRANGER.memberNo,
          fullName: STRANGER.memberName,
          monthlyEarningsKyd: STRANGER.earningsKyd,
          voluntaryKyd: 0,
        },
        WRONG_EMPLOYER_RATE,
      ),
    ];
  }
  return members.map((member) => lineFor(member));
}

export function linesTotal(lines: SampleLine[]): number {
  return cents(
    lines.reduce(
      (sum, line) =>
        sum + line.employeeKyd + line.employerKyd + line.voluntaryKyd,
      0,
    ),
  );
}

/** The Schedules shipped as sample files, uploaded for last month. */
export const UPLOAD_SCHEDULES = {
  clean: { employerCode: "ER-1001", lines: ordinaryLines("ER-1001") },
  wrongRate: { employerCode: "ER-1005", lines: ordinaryLines("ER-1005") },
} as const;
