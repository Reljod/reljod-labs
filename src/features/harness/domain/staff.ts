/** What a Staff member may do. Decided in one place: `can()` in `permissions.ts`. */
export type Role = "user" | "admin";

export const ROLES: Role[] = ["user", "admin"];

export const ROLE_LABEL: Record<Role, string> = {
  user: "User",
  admin: "Admin",
};

/**
 * A named person who works in a Workspace. Not an Auth user: Access still
 * comes from the Host or the Guest pass (ADR 0014).
 */
export type Staff = {
  id: string;
  /** The same in every Workspace (`officer-1`), so a Scenario can name who to switch to. */
  key: string;
  name: string;
  title: string;
  role: Role;
  initials: string;
};

export type SeedStaff = Omit<Staff, "id">;

/**
 * The Staff every Workspace starts with: two pensions officers and one
 * operations manager. Fictional people at a fictional bank. The first `user`
 * is who a visitor is signed in as until they choose.
 */
export const SEED_STAFF: SeedStaff[] = [
  {
    key: "officer-1",
    name: "Keisha Wraymond",
    title: "Pensions Officer",
    role: "user",
    initials: "KW",
  },
  {
    key: "officer-2",
    name: "Dario Pennycooke",
    title: "Senior Pensions Officer",
    role: "user",
    initials: "DP",
  },
  {
    key: "manager",
    name: "Marva Lindo-Tibbett",
    title: "Operations Manager",
    role: "admin",
    initials: "ML",
  },
];

/** The Staff member a visitor is until they choose: the first `user`. */
export function defaultStaff<T extends Pick<Staff, "role">>(
  staff: T[],
): T | null {
  return staff.find((member) => member.role === "user") ?? staff[0] ?? null;
}
