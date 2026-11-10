import { sameName, words } from "../names";
import { RULEBOOK } from "../rulebook";
import {
  type Check,
  documentsOf,
  firstOf,
  list,
  names,
  type Ownership,
  type OwnershipLink,
  type RunState,
  text,
  type Ubo,
} from "../run-state";
import { companyKey } from "./entity";
import type { JobOutcome } from "./types";

const ENTITY_WORDS = new Set([
  "ltd",
  "limited",
  "llc",
  "inc",
  "lp",
  "plc",
  "holdings",
  "holding",
  "trust",
  "trustees",
  "foundation",
  "company",
  "corp",
  "corporation",
  "sa",
  "bv",
  "partners",
  "fund",
  "capital",
  "nominees",
  "nominee",
  "group",
  "spc",
  "investments",
]);

const isEntityName = (name: string) =>
  words(name).some((word) => ENTITY_WORDS.has(word));

type Member = {
  holder_name?: string;
  holder_type?: string;
  percentage?: number | string;
};

const pct = (value: unknown) => {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** map_ownership: unwind registers, charts and trust deeds to the people at 10% and the controllers. */
export function mapOwnership(state: RunState): JobOutcome {
  const registers = documentsOf(state, "register_of_members").filter(
    (document) => document.fields,
  );
  const charts = documentsOf(state, "structure_chart").filter(
    (document) => document.fields,
  );
  const deeds = documentsOf(state, "trust_deed").filter(
    (document) => document.fields,
  );
  const appointments = documentsOf(state, "deed_of_appointment").filter(
    (document) => document.fields,
  );

  const links: OwnershipLink[] = [];
  const naturalPeople = new Set<string>();
  const entityKeys = new Set<string>();
  const registered = new Set<string>();
  const sums: { entity: string; total: number }[] = [];

  for (const register of registers) {
    const entity = text(register, "entity_name");
    registered.add(companyKey(entity));
    entityKeys.add(companyKey(entity));
    const members = list<Member>(register, "members");
    let total = 0;
    for (const member of members) {
      const holder = member.holder_name ?? "";
      const percentage = pct(member.percentage);
      total += percentage;
      links.push({
        owner: holder,
        owned: entity,
        percentage,
        relation: "shareholding",
      });
      // The reader may say "Individual", "natural person" or nothing; the name decides then.
      const type = (member.holder_type ?? "").toLowerCase();
      const person = /individ|person|natural/.test(type)
        ? true
        : /compan|corp|trust|nominee|llc|partnership|fund|foundation/.test(type)
          ? false
          : !isEntityName(holder);
      if (person) naturalPeople.add(holder);
      else entityKeys.add(companyKey(holder));
    }
    sums.push({ entity, total });
  }
  for (const chart of charts) {
    for (const link of list<OwnershipLink>(chart, "links")) {
      const relation = link.relation || "shareholding";
      const exists = links.some(
        (item) =>
          companyKey(item.owner) === companyKey(link.owner) &&
          companyKey(item.owned) === companyKey(link.owned) &&
          item.relation === relation,
      );
      // Registers are primary evidence; the chart only fills layers no register covers.
      if (
        exists ||
        (relation === "shareholding" && registered.has(companyKey(link.owned)))
      )
        continue;
      links.push({ ...link, relation, percentage: pct(link.percentage) });
      if (relation === "shareholding") {
        entityKeys.add(companyKey(link.owned));
        if (isEntityName(link.owner)) entityKeys.add(companyKey(link.owner));
      }
    }
  }

  const controllers: Ubo[] = [];
  const addController = (name: string, role: string) => {
    if (
      !name ||
      controllers.some(
        (item) => sameName(item.name, name) && item.role === role,
      )
    )
      return;
    controllers.push({
      name,
      percentage: null,
      role,
      path: role,
      verified: false,
    });
  };
  for (const deed of deeds) {
    const trust = text(deed, "trust_name");
    entityKeys.add(companyKey(trust));
    for (const settlor of names(deed, "settlor_names"))
      addController(settlor, "settlor");
    for (const trustee of names(deed, "trustee_names"))
      addController(trustee, "trustee");
    for (const protector of names(deed, "protector_names"))
      addController(protector, "protector");
    for (const beneficiary of names(deed, "beneficiary_names"))
      addController(beneficiary, "beneficiary");
  }
  for (const appointment of appointments) {
    const role = text(appointment, "role") || "trustee";
    for (const name of names(appointment, "appointed_names"))
      addController(name, role);
    for (const name of names(appointment, "removed_names")) {
      const index = controllers.findIndex(
        (item) => sameName(item.name, name) && item.role === role,
      );
      if (index >= 0) controllers.splice(index, 1);
    }
  }
  for (const link of links.filter((item) => item.relation !== "shareholding")) {
    addController(link.owner, link.relation.replace(/_of$/, ""));
  }
  // Corporate trustees and companies are not people.
  const peopleControllers = controllers.filter(
    (item) => !isEntityName(item.name),
  );

  const isEntity = (name: string) =>
    entityKeys.has(companyKey(name)) ||
    (isEntityName(name) && !naturalPeople.has(name));

  // The top entity: the certificate's, the chart's, or the register no one else owns.
  const owned = new Set(
    links
      .filter((link) => link.relation === "shareholding")
      .map((link) => companyKey(link.owned)),
  );
  const owners = new Set(
    links
      .filter((link) => link.relation === "shareholding")
      .map((link) => companyKey(link.owner)),
  );
  const top =
    text(firstOf(state, "certificate_of_incorporation"), "entity_name") ||
    text(charts[0], "top_entity") ||
    [...owned]
      .map(
        (key) =>
          links.find((link) => companyKey(link.owned) === key)?.owned ?? key,
      )
      .find((name) => !owners.has(companyKey(name))) ||
    text(deeds[0], "trust_name");

  // Multiply down every chain from the top.
  const effective = new Map<string, { percentage: number; path: string[] }>();
  const unregistered = new Set<string>();
  const walk = (
    entity: string,
    share: number,
    path: string[],
    depth: number,
  ) => {
    if (depth > 8) return;
    const holders = links.filter(
      (link) =>
        link.relation === "shareholding" &&
        companyKey(link.owned) === companyKey(entity),
    );
    if (holders.length === 0 && depth > 0) unregistered.add(entity);
    for (const link of holders) {
      const next = (share * link.percentage) / 100;
      const step = [...path, `${link.percentage}%`];
      if (isEntity(link.owner)) {
        walk(link.owner, next, step, depth + 1);
      } else {
        const key =
          [...effective.keys()].find((name) => sameName(name, link.owner)) ??
          link.owner;
        const current = effective.get(key);
        effective.set(key, {
          percentage: (current?.percentage ?? 0) + next,
          path: current ? [current.path.join(" x "), step.join(" x ")] : step,
        });
      }
    }
  };
  if (top) walk(top, 100, [], 0);
  // A trust that holds shares: its people control what it holds.
  const trustHolders = [...unregistered].filter((name) => /trust/i.test(name));
  for (const name of trustHolders) unregistered.delete(name);

  const ids = documentsOf(state, "identity_document").filter(
    (document) => document.fields,
  );
  const verified = (name: string) =>
    ids.some((id) => sameName(text(id, "full_name"), name));

  const people = [...effective.entries()].map(
    ([name, value]): Ubo => ({
      name,
      percentage: Math.round(value.percentage * 100) / 100,
      role: "owner",
      path: value.path.join(" x "),
      verified: verified(name),
    }),
  );
  const ubos = [
    ...people.filter(
      (person) => (person.percentage ?? 0) >= RULEBOOK.uboThreshold,
    ),
    ...peopleControllers
      .filter(
        (controller) =>
          !people.some(
            (person) =>
              sameName(person.name, controller.name) &&
              (person.percentage ?? 0) >= RULEBOOK.uboThreshold,
          ),
      )
      .map((controller) => ({
        ...controller,
        verified: verified(controller.name),
      })),
  ];
  const others = people.filter(
    (person) => (person.percentage ?? 0) < RULEBOOK.uboThreshold,
  );
  const ownership: Ownership = { top: top ?? "", links, ubos, others };

  const checks: Check[] = [];
  const evidence = [...registers, ...charts, ...deeds].map((document) => ({
    documentId: document.id,
  }));
  const broken = sums.filter((item) => Math.abs(item.total - 100) > 0.5);
  if (sums.length > 0) {
    checks.push({
      id: "ownership_reconciles",
      outcome: broken.length === 0 ? "pass" : "fail",
      detail:
        broken.length === 0
          ? `${sums.length} register${sums.length === 1 ? "" : "s"}, each adding up to 100%`
          : broken
              .map(
                (item) =>
                  `${item.entity} adds up to ${Math.round(item.total * 100) / 100}%`,
              )
              .join("; "),
      job: "map_ownership",
      evidence,
    });
  }
  const owning = ubos.filter((ubo) => ubo.percentage !== null);
  checks.push({
    id: "ubos_identified",
    outcome:
      unregistered.size > 0 ? "review" : ubos.length > 0 ? "pass" : "review",
    detail:
      unregistered.size > 0
        ? `No register for ${[...unregistered].join(", ")}, so whoever owns it is unknown`
        : owning.length > 0
          ? owning
              .map(
                (ubo) =>
                  `${ubo.name} ${ubo.percentage}%${ubo.path.includes("x") ? ` (${ubo.path})` : ""}`,
              )
              .join("; ")
          : peopleControllers.length > 0
            ? `A trust: ${peopleControllers.map((item) => `${item.name} (${item.role})`).join(", ")}`
            : "No natural person found at 10% or more",
    job: "map_ownership",
    evidence,
  });
  const directorRegister = documentsOf(state, "register_of_directors").some(
    (document) => document.fields,
  );
  checks.push({
    id: "controllers_identified",
    outcome:
      deeds.length > 0
        ? peopleControllers.length > 0
          ? "pass"
          : "review"
        : directorRegister
          ? "pass"
          : "review",
    detail:
      deeds.length > 0
        ? peopleControllers.length > 0
          ? `Trust controllers: ${peopleControllers.map((item) => `${item.name} (${item.role})`).join(", ")}`
          : "The trust deed names no individual settlor, protector or beneficiary"
        : directorRegister
          ? "Directors are on the register of directors"
          : "No register of directors, so who controls the company is unknown",
    job: "map_ownership",
    evidence,
  });
  const unverified = ubos.filter((ubo) => !ubo.verified);
  if (ubos.length > 0) {
    checks.push({
      id: "ubos_verified",
      outcome: unverified.length === 0 ? "pass" : "fail",
      detail:
        unverified.length === 0
          ? `Every owner and controller has an ID on file`
          : `No ID on file for ${unverified.map((ubo) => ubo.name).join(", ")}`,
      job: "map_ownership",
      evidence: ids.map((id) => ({ documentId: id.id, field: "full_name" })),
    });
  }

  const question =
    unverified.length > 0
      ? {
          prompt: `I have no ID for ${unverified.map((ubo) => ubo.name).join(", ")}. Can you add certified copies?`,
          kinds: ["identity_document" as const],
        }
      : undefined;
  return {
    checks,
    question,
    patch: { ownership },
    summary:
      ubos.length > 0
        ? `${ubos.length} owner${ubos.length === 1 ? "" : "s"} and controllers at 10%+: ${ubos.map((ubo) => ubo.name).join(", ")}`
        : "No owner at 10% found",
  };
}
