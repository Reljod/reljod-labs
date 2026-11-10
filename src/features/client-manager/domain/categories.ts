/**
 * The Category tree: every Node sits in exactly one leaf Category, and the
 * Graph view lays Categories out as fixed slots so the client's network never
 * piles into one hairball. Ids are `branch.leaf`.
 */

export type Branch = {
  id: string;
  label: string;
  /** One short line the view shows when the Branch is opened. */
  blurb: string;
  /** Colonnade token name, used for the Branch's hub and its Nodes. */
  tone: Tone;
  leaves: { id: string; label: string; hint: string }[];
};

export type Tone =
  | "federal-blue"
  | "ivy"
  | "brass"
  | "oak"
  | "seal-red"
  | "clear-sky"
  | "stone"
  | "ink";

export const TONE_HEX: Record<Tone, string> = {
  "federal-blue": "#1d4e89",
  ivy: "#2f6b3f",
  brass: "#d9a84e",
  oak: "#6b4226",
  "seal-red": "#b23a2b",
  "clear-sky": "#6fa0dc",
  stone: "#8a8478",
  ink: "#14213d",
};

export const BRANCHES = [
  {
    id: "profile",
    label: "Profile",
    blurb: "Who they are on paper",
    tone: "ink",
    leaves: [
      {
        id: "personal",
        label: "Personal",
        hint: "age, birthday, nationality, residence, tax residency, languages",
      },
      {
        id: "contact",
        label: "Contact",
        hint: "phone, email, addresses, assistants who handle contact",
      },
      {
        id: "documents",
        label: "Documents",
        hint: "statements, IDs, agreements and other paperwork that was shared",
      },
    ],
  },
  {
    id: "network",
    label: "Family & network",
    blurb: "The people around them",
    tone: "federal-blue",
    leaves: [
      {
        id: "family",
        label: "Family",
        hint: "spouse, children, parents, siblings, grandchildren, pets",
      },
      {
        id: "advisors",
        label: "Advisors",
        hint: "lawyers, accountants, doctors, other bankers, trustees",
      },
      {
        id: "social",
        label: "Social",
        hint: "friends, clubs, communities, referrers",
      },
    ],
  },
  {
    id: "career",
    label: "Career & business",
    blurb: "How the money is made",
    tone: "oak",
    leaves: [
      {
        id: "work",
        label: "Work",
        hint: "employers, roles, board seats, retirement status",
      },
      {
        id: "business",
        label: "Business",
        hint: "companies they own or founded, stakes, exits",
      },
      {
        id: "income",
        label: "Income",
        hint: "salary, dividends, rents, pensions, bonuses",
      },
    ],
  },
  {
    id: "wealth",
    label: "Wealth",
    blurb: "What they own and owe",
    tone: "ivy",
    leaves: [
      {
        id: "accounts",
        label: "Accounts",
        hint: "bank, brokerage, retirement and custody accounts",
      },
      {
        id: "holdings",
        label: "Holdings",
        hint: "positions, funds, private equity, crypto, cash balances",
      },
      {
        id: "property",
        label: "Property",
        hint: "homes, land, art, boats, collectibles",
      },
      {
        id: "liabilities",
        label: "Liabilities",
        hint: "mortgages, loans, credit lines, guarantees",
      },
      {
        id: "insurance",
        label: "Insurance",
        hint: "life, health, property and liability cover",
      },
    ],
  },
  {
    id: "goals",
    label: "Goals & plans",
    blurb: "Where they want to go",
    tone: "brass",
    leaves: [
      {
        id: "objectives",
        label: "Objectives",
        hint: "retirement, purchases, education funding, liquidity needs",
      },
      {
        id: "estate",
        label: "Estate",
        hint: "wills, trusts, succession, beneficiaries, powers of attorney",
      },
      {
        id: "philanthropy",
        label: "Philanthropy",
        hint: "causes, foundations, pledges, donations",
      },
    ],
  },
  {
    id: "persona",
    label: "Personality",
    blurb: "How to work with them",
    tone: "clear-sky",
    leaves: [
      {
        id: "traits",
        label: "Traits",
        hint: "temperament, decision style, what earns their trust",
      },
      {
        id: "communication",
        label: "Communication",
        hint: "preferred channel, cadence, tone, language, meeting habits",
      },
      {
        id: "interests",
        label: "Interests",
        hint: "hobbies, sports, travel, food, passions",
      },
      {
        id: "values",
        label: "Values",
        hint: "beliefs, ESG preferences, red lines, what they care about",
      },
    ],
  },
  {
    id: "risk",
    label: "Risk & compliance",
    blurb: "What could go wrong",
    tone: "seal-red",
    leaves: [
      {
        id: "profile",
        label: "Risk profile",
        hint: "risk tolerance, horizon, loss aversion, past reactions to drawdowns",
      },
      {
        id: "compliance",
        label: "Compliance",
        hint: "KYC status, source of wealth, PEP or sanctions notes, restrictions",
      },
      {
        id: "health",
        label: "Health",
        hint: "health matters the client chose to share that affect planning",
      },
      {
        id: "concerns",
        label: "Concerns",
        hint: "worries, complaints, open issues, sensitivities",
      },
    ],
  },
  {
    id: "timeline",
    label: "Life events",
    blurb: "What happened and what's next",
    tone: "stone",
    leaves: [
      {
        id: "past",
        label: "Past",
        hint: "milestones that already happened: weddings, sales, moves, losses",
      },
      {
        id: "upcoming",
        label: "Upcoming",
        hint: "dated plans and reminders: birthdays, renewals, closings, trips",
      },
    ],
  },
] as const satisfies readonly Branch[];

export type BranchId = (typeof BRANCHES)[number]["id"];

export type CategoryId = {
  [B in (typeof BRANCHES)[number] as B["id"]]: `${B["id"]}.${B["leaves"][number]["id"]}`;
}[BranchId];

export const CATEGORY_IDS = BRANCHES.flatMap((branch) =>
  branch.leaves.map((leaf) => `${branch.id}.${leaf.id}`),
) as CategoryId[];

const CATEGORY_SET = new Set<string>(CATEGORY_IDS);

export function isCategory(value: string): value is CategoryId {
  return CATEGORY_SET.has(value);
}

export function branchOf(category: string): BranchId {
  return category.split(".")[0] as BranchId;
}

export function findBranch(id: string): Branch | undefined {
  return BRANCHES.find((branch) => branch.id === id);
}

export function categoryLabel(category: string) {
  const [branchId, leafId] = category.split(".");
  const branch = findBranch(branchId ?? "");
  const leaf = branch?.leaves.find((item) => item.id === leafId);
  return {
    branch: branch?.label ?? branchId ?? "",
    leaf: leaf?.label ?? leafId ?? "",
  };
}

export function toneOf(category: string): string {
  const branch = findBranch(branchOf(category));
  return TONE_HEX[branch?.tone ?? "stone"];
}

/** The tree written out for a prompt: `branch.leaf: hint`. */
export function describeCategories() {
  return BRANCHES.flatMap((branch) =>
    branch.leaves.map(
      (leaf) =>
        `- ${branch.id}.${leaf.id} (${branch.label} › ${leaf.label}): ${leaf.hint}`,
    ),
  ).join("\n");
}

/**
 * Where a Node lands when the model names a Category that doesn't exist:
 * the leaf whose words it shares, else the Branch's first leaf, else Profile.
 */
export function nearestCategory(value: string): CategoryId {
  if (isCategory(value)) return value;
  const normalized = value.toLowerCase().trim();
  const [head, tail] = normalized.split(/[.›/>]/).map((part) => part.trim());
  for (const branch of BRANCHES) {
    for (const leaf of branch.leaves) {
      if (
        leaf.id === tail ||
        leaf.id === head ||
        leaf.label.toLowerCase() === tail ||
        leaf.label.toLowerCase() === head
      ) {
        return `${branch.id}.${leaf.id}` as CategoryId;
      }
    }
  }
  const branch = BRANCHES.find(
    (item) => item.id === head || item.label.toLowerCase() === head,
  );
  if (branch) return `${branch.id}.${branch.leaves[0].id}` as CategoryId;
  return "profile.personal";
}
