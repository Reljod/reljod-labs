/**
 * Parties planted in a Corpus Document, and every surface form each can be
 * printed in. The generator picks a form per mention and the Answer key
 * records exactly what was printed.
 */
import type { EntityType } from "../contract";
import {
  CULTURES,
  type Culture,
  type GivenSeed,
  LEGAL_SUFFIXES,
  ORG_SECTORS,
  ORG_WORDS,
} from "./pools";
import type { Rng } from "./prng";

export type Style =
  // people
  | "full"
  | "short"
  | "initials"
  | "initialShort"
  | "reordered"
  | "reorderedShort"
  | "caps"
  | "swift"
  | "swiftReversed"
  | "honorific"
  | "honSurname"
  | "nickname"
  | "translit"
  | "native"
  // organizations
  | "alt"
  | "orgShort"
  // both
  | "lower"
  | "typo"
  /** OCR damage: lowercase, digits for letters, "rn" for "m", hyphens lost. */
  | "ocr"
  /** The local part of an email address ("j.okafor"). */
  | "handle";

/**
 * How a hard-only party is printed: never in a clean form anywhere in the
 * Document, so only a careful reader (or a Reader sub-agent) finds it.
 */
export type HardKind = "ocr" | "cell" | "pagesplit" | "handle" | "initials";

/** Forms a sweep can be expected to see: never lowercase OCR noise. */
export const CLEAN_STYLES: ReadonlySet<Style> = new Set<Style>([
  "full",
  "short",
  "initials",
  "reordered",
  "caps",
  "swift",
  "swiftReversed",
  "honorific",
  "native",
  "alt",
  "orgShort",
]);

export type OfficialKind = "judge" | "registrar" | "notary" | "police";

export type Party = {
  index: number;
  type: EntityType;
  canonical: string;
  forms: Partial<Record<Style, string>>;
  /** Email address printed near the name (people), or the mail domain (organizations). */
  email?: string;
  domain?: string;
  official?: OfficialKind;
  /** Printed once only, late in the Document. */
  tail?: boolean;
  /** Printed only in hard forms. */
  hard?: HardKind;
};

/** Strips accents for SWIFT and OCR forms. */
export function ascii(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O");
}

const initial = (given: string) => `${given[0]}.`;

/** Damages text the way a poor scan does: 1-2 slips on a lowercase copy. */
function ocrDamage(text: string, rng: Rng): string {
  let s = ascii(text).toLowerCase();
  if (rng.chance(0.5)) s = s.replace(/-/g, " ");
  const once = (from: RegExp, to: string) => (t: string) => t.replace(from, to);
  const slips = rng.shuffle([
    once(/(?<=\S)o/, "0"),
    once(/(?<=\S)l/, "1"),
    once(/rn/, "m"),
    once(/(?<=\S)m/, "rn"),
  ]);
  const wanted = rng.int(1, 2);
  let applied = 0;
  for (const slip of slips) {
    const next = slip(s);
    if (next === s) continue;
    s = next;
    if (++applied >= wanted) break;
  }
  return s;
}

/** Swaps two letters inside the longest word of `text` (OCR or typing slip). */
function typo(
  text: string,
  rng: Rng,
  from: "first" | "last",
): string | undefined {
  // Only the surname of a person, only the first word of a company.
  const words = text.split(" ");
  const best = from === "last" ? words.length - 1 : 0;
  if (!/^\p{Lu}[\p{Ll}]{4,}$/u.test(words[best].split("-")[0] ?? ""))
    return undefined;
  const word = words[best];
  const head = word.split("-")[0];
  for (let tries = 0; tries < 6; tries++) {
    const at = rng.int(1, head.length - 3);
    if (head[at] === head[at + 1]) continue;
    const swapped =
      head.slice(0, at) + head[at + 1] + head[at] + head.slice(at + 2);
    words[best] = swapped + word.slice(head.length);
    return words.join(" ");
  }
  return undefined;
}

const OFFICIAL_TITLES: Record<OfficialKind, { long: string; short: string }> = {
  judge: { long: "Hon. Justice", short: "Justice" },
  registrar: { long: "Registrar", short: "Registrar" },
  notary: { long: "Notary Public", short: "Notary" },
  police: { long: "Det. Insp.", short: "Inspector" },
};

/** Surnames and company words a Document has used, so no two parties collide. */
export type Taken = { surnames: Set<string>; orgs: Set<string> };

function pickSurname(rng: Rng, culture: Culture, taken: Taken) {
  const free = culture.surnames.filter(
    (s) => !taken.surnames.has(s.split("|")[0]),
  );
  if (free.length === 0) return undefined;
  const raw = rng.pick(free);
  const [surname, variant] = raw.split("|");
  taken.surnames.add(surname);
  return { surname, variant };
}

/** Volkov -> Volkova, Petrovsky -> Petrovskaya. */
function feminine(surname: string): string {
  if (/sky$/.test(surname)) return surname.replace(/sky$/, "skaya");
  if (/(ov|ev|in)$/.test(surname)) return `${surname}a`;
  return surname;
}

function pickCulture(rng: Rng, taken: Taken): Culture {
  for (let tries = 0; tries < 30; tries++) {
    const culture = rng.pick(CULTURES);
    if (culture.surnames.some((s) => !taken.surnames.has(s.split("|")[0])))
      return culture;
  }
  throw new Error("Corpus: surname pools exhausted");
}

export function makePerson(
  rng: Rng,
  index: number,
  taken: Taken,
  official?: OfficialKind,
): Party {
  const culture = pickCulture(rng, taken);
  const seed: GivenSeed = rng.pick(culture.given);
  const picked = pickSurname(rng, culture, taken);
  if (!picked) throw new Error("Corpus: no surname");
  const female = culture.gendered && seed.sex === "f";
  const surname = female ? feminine(picked.surname) : picked.surname;
  const surnameVariant =
    picked.variant && female ? feminine(picked.variant) : picked.variant;
  const middle =
    culture.middle && rng.chance(0.35)
      ? rng.pick(culture.middle[seed.sex])
      : undefined;
  const given = middle ? [seed.name, middle] : [seed.name];
  const full = `${given.join(" ")} ${surname}`;
  const forms: Partial<Record<Style, string>> = {
    full,
    initials: `${given.map(initial).join(" ")} ${surname}`,
    reordered: `${surname.toUpperCase()}, ${given.join(" ")}`,
    reorderedShort: `${surname}, ${seed.name}`,
    caps: full.toUpperCase(),
    swift: ascii(full).toUpperCase(),
    swiftReversed: ascii(`${surname} ${given.join(" ")}`).toUpperCase(),
    lower: ascii(full).toLowerCase(),
  };
  if (middle) {
    forms.short = `${seed.name} ${surname}`;
    forms.initialShort = `${initial(seed.name)} ${surname}`;
  }
  if (official) {
    const title = OFFICIAL_TITLES[official];
    forms.honorific = `${title.long} ${full}`;
    forms.honSurname = `${title.short} ${surname}`;
  } else {
    const honorific = rng.pick(culture.honorifics[seed.sex]);
    forms.honorific = `${honorific} ${full}`;
    if (!["Sheikh", "Sheikha", "Sir"].includes(honorific))
      forms.honSurname = `${honorific} ${surname}`;
  }
  if (seed.nick) forms.nickname = `${seed.nick} ${surname}`;
  if (seed.variants || surnameVariant) {
    const givenVariant = seed.variants ? rng.pick(seed.variants) : seed.name;
    forms.translit = `${[givenVariant, ...given.slice(1)].join(" ")} ${surnameVariant ?? surname}`;
  }
  if (culture.surnameFirst)
    forms.native = `${surname.toUpperCase()} ${seed.name}`;
  forms.ocr = ocrDamage(full, rng);
  const slip = typo(full, rng, "last");
  if (slip && slip !== full) forms.typo = slip;
  const local = ascii(surname)
    .toLowerCase()
    .replace(/^(van der|van den|van|von|de la|de|dos|bin|ter|al-|el-)\s*/, "")
    .replace(/[^a-z]/g, "");
  forms.handle = `${ascii(seed.name)[0].toLowerCase()}.${local}`;
  return {
    index,
    type: "person",
    canonical: full,
    forms,
    email: `${ascii(seed.name)[0].toLowerCase()}.${local}`,
    official,
  };
}

type OrgShape =
  | "standard"
  | "holdings"
  | "trust"
  | "foundation"
  | "shell"
  | "partnership";

function freeWord(rng: Rng, taken: Taken): string {
  for (let tries = 0; tries < 40; tries++) {
    const word = rng.pick(ORG_WORDS);
    if (!taken.orgs.has(word)) {
      taken.orgs.add(word);
      return word;
    }
  }
  // Group companies share a first word; allowed when the pool runs dry.
  return rng.pick(ORG_WORDS);
}

export function makeOrganization(rng: Rng, index: number, taken: Taken): Party {
  const shape = rng.weighted<OrgShape>({
    standard: 52,
    holdings: 13,
    trust: 8,
    foundation: 6,
    shell: 13,
    partnership: 8,
  });
  const legal = rng.pick(LEGAL_SUFFIXES);
  const forms: Partial<Record<Style, string>> = {};
  let core: string;
  let canonical: string;
  let swiftCore: string;
  let suffixed = true;
  switch (shape) {
    case "standard":
    case "holdings": {
      core = `${freeWord(rng, taken)} ${shape === "holdings" ? "Holdings" : rng.pick(ORG_SECTORS)}`;
      canonical = `${core} ${legal.suffix}`;
      swiftCore = core;
      forms.orgShort = core;
      break;
    }
    case "trust": {
      const person = makePerson(rng, -1, taken);
      const surname = person.canonical.split(" ").slice(-1)[0];
      core = `${surname} Family Trust`;
      canonical = core;
      swiftCore = core;
      suffixed = false;
      break;
    }
    case "foundation": {
      core = `${freeWord(rng, taken)} Foundation`;
      canonical = core;
      swiftCore = core;
      suffixed = false;
      break;
    }
    case "shell": {
      // A shell company with a person-like name.
      const person = makePerson(rng, -1, taken);
      core = person.forms.short ?? person.canonical;
      canonical = `${core} ${legal.suffix}`;
      swiftCore = core;
      break;
    }
    case "partnership": {
      const a = makePerson(rng, -1, taken).canonical.split(" ").slice(-1)[0];
      const b = makePerson(rng, -1, taken).canonical.split(" ").slice(-1)[0];
      core = `${a} & ${b}`;
      canonical = `${core} LLP`;
      swiftCore = `${a} AND ${b}`;
      forms.orgShort = core;
      forms.alt = `${a} and ${b} LLP`;
      suffixed = false;
      break;
    }
  }
  forms.full = canonical;
  if (suffixed && legal.alt) forms.alt = `${core} ${legal.alt}`;
  forms.caps = canonical.toUpperCase();
  forms.swift = ascii(
    suffixed
      ? `${swiftCore} ${legal.swift}`
      : shape === "partnership"
        ? `${swiftCore} LLP`
        : swiftCore,
  ).toUpperCase();
  forms.lower = ascii(canonical).toLowerCase();
  forms.ocr = ocrDamage(canonical, rng);
  const slip = typo(canonical, rng, "first");
  if (slip && slip !== canonical) forms.typo = slip;
  return {
    index,
    type: "organization",
    canonical,
    forms,
    domain: `${ascii(core)
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 18)}.mr`,
  };
}
