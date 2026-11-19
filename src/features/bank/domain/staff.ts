/**
 * Staff of one Owner's bank. A Role decides what a Staff member may do
 * (`can` in permissions.ts) and who may check whose work. Anyone in a bank
 * may switch Staff, so a Role is not a security boundary between visitors:
 * Access and the Owner are. It is the bank's own control (maker-checker).
 */
export type Role = "teller" | "supervisor" | "compliance";

export type Staff = {
  id: string;
  key: string;
  name: string;
  title: string;
  role: Role;
  initials: string;
};

export const ROLE_LABEL: Record<Role, string> = {
  teller: "Teller",
  supervisor: "Supervisor",
  compliance: "Compliance officer",
};

/** The Staff every new bank starts with. Fictional people of Meridia. */
export const SEED_STAFF: Omit<Staff, "id">[] = [
  {
    key: "ines-maro",
    name: "Ines Maro",
    title: "Branch teller",
    role: "teller",
    initials: "IM",
  },
  {
    key: "tomas-vell",
    name: "Tomas Vell",
    title: "Branch supervisor",
    role: "supervisor",
    initials: "TV",
  },
  {
    key: "renske-aldo",
    name: "Renske Aldo",
    title: "Operations manager",
    role: "supervisor",
    initials: "RA",
  },
  {
    key: "odile-karn",
    name: "Odile Karn",
    title: "Compliance officer",
    role: "compliance",
    initials: "OK",
  },
];

/** Who a visitor is signed in as before they choose: the teller. */
export function defaultStaff<T extends Pick<Staff, "role">>(
  staff: T[],
): T | undefined {
  return staff.find((member) => member.role === "teller") ?? staff[0];
}
