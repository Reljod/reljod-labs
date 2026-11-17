/**
 * Alias resolution without a model: when two printed forms name the same
 * party, and how Names fold together in the Register. Pure functions; the
 * Analyst, the Sweep and the scorer all use them.
 */
import type { ExtractedName, Rulebook } from "./contract";

// Tables ---------------------------------------------------------------------------------

/** Leading words that are titles, not names. */
const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "prof",
  "sir",
  "dame",
  "lady",
  "lord",
  "hon",
  "honourable",
  "honorable",
  "the",
  "justice",
  "judge",
  "sheikh",
  "sheikha",
  "chief",
  "rev",
  "fr",
  "sr",
  "sra",
  "srta",
  "mme",
  "mlle",
  "herr",
  "frau",
  "notary",
  "public",
  "registrar",
  "det",
  "insp",
  "inspector",
  "detective",
  "capt",
  "captain",
  "atty",
  "eng",
]);

/** Name particles; ignored when comparing ("van der Merwe" = "Merwe"). */
const PARTICLES = new Set([
  "van",
  "der",
  "den",
  "de",
  "del",
  "della",
  "la",
  "le",
  "dos",
  "das",
  "da",
  "do",
  "du",
  "von",
  "bin",
  "binti",
  "ibn",
  "al",
  "el",
  "ter",
  "ten",
  "af",
  "zu",
  "y",
]);

/** Legal-form suffixes, normalised. */
const LEGAL: Record<string, string> = {
  ltd: "ltd",
  limited: "ltd",
  llc: "llc",
  llp: "llp",
  lp: "lp",
  inc: "inc",
  incorporated: "inc",
  corp: "corp",
  corporation: "corp",
  plc: "plc",
  sa: "sa",
  sas: "sas",
  sarl: "sarl",
  srl: "srl",
  spa: "spa",
  gmbh: "gmbh",
  ag: "ag",
  kg: "kg",
  bv: "bv",
  nv: "nv",
  pte: "pte",
  pty: "pty",
};

/** Words that make a string an organization rather than a person. */
const ORG_WORDS = new Set([
  ...Object.keys(LEGAL),
  "holdings",
  "holding",
  "group",
  "trust",
  "foundation",
  "fundacion",
  "stiftung",
  "bank",
  "partners",
  "partnership",
  "capital",
  "ventures",
  "trading",
  "logistics",
  "shipping",
  "maritime",
  "commodities",
  "investments",
  "properties",
  "consulting",
  "imports",
  "exports",
  "freight",
  "metals",
  "minerals",
  "energy",
  "textiles",
  "agro",
  "industries",
  "international",
  "enterprises",
  "services",
  "solutions",
  "associates",
  "pharma",
  "and",
  "company",
  "family",
  "fund",
  "insurance",
]);

/** Transliteration groups: every spelling maps to the first. */
const TRANSLIT: string[][] = [
  [
    "mohammed",
    "muhammad",
    "mohamad",
    "mohamed",
    "mohammad",
    "muhammed",
    "mohd",
  ],
  ["ahmed", "ahmad"],
  ["yusuf", "yousef", "youssef", "yousuf", "yosef"],
  ["hussein", "husain", "hussain", "husayn"],
  ["abdullah", "abdallah"],
  ["khalid", "khaled"],
  ["omar", "umar"],
  ["fatima", "fatimah"],
  ["aisha", "ayesha", "aysha"],
  ["layla", "leila", "laila"],
  ["tariq", "tareq", "tarek"],
  ["aleksandr", "alexander", "alexandr", "aleksander", "alexandre"],
  ["sergei", "sergey", "sergej"],
  ["dmitri", "dmitry", "dmitriy"],
  ["yuri", "yury", "iouri", "yuriy"],
  ["natalia", "natalya", "nataliya"],
  ["yelena", "elena", "jelena"],
  ["viktor", "victor"],
  ["mikhail", "michail"],
  ["andrei", "andrey"],
  ["nikolai", "nikolay"],
  ["fyodorov", "fedorov"],
  ["kuznetsov", "kouznetsov"],
  ["grunwald", "gruenwald"],
  ["muller", "mueller"],
  ["zhou", "chou"],
];

/** Nicknames: each maps to its full given name. */
const NICKNAMES: Record<string, string> = {
  bill: "william",
  will: "william",
  billy: "william",
  liam: "william",
  peggy: "margaret",
  maggie: "margaret",
  meg: "margaret",
  bob: "robert",
  rob: "robert",
  bobby: "robert",
  liz: "elizabeth",
  beth: "elizabeth",
  betty: "elizabeth",
  eliza: "elizabeth",
  jim: "james",
  jimmy: "james",
  jamie: "james",
  kate: "catherine",
  cathy: "catherine",
  katie: "catherine",
  rick: "richard",
  dick: "richard",
  rich: "richard",
  ted: "edward",
  ed: "edward",
  eddie: "eduardo",
  ned: "edward",
  jon: "jonathan",
  trish: "patricia",
  pat: "patricia",
  patty: "patricia",
  tom: "thomas",
  tommy: "thomas",
  nell: "eleanor",
  nellie: "eleanor",
  joe: "joseph",
  mike: "michael",
  tony: "anthony",
  chris: "christopher",
  ben: "benjamin",
  nick: "nicholas",
  alex: "aleksandr",
  sasha: "aleksandr",
  dima: "dmitri",
  katya: "yekaterina",
  emeka: "chukwuemeka",
  seun: "oluwaseun",
  tunde: "babatunde",
  ada: "adaeze",
  ify: "ifeoma",
  hanna: "johanna",
  wim: "willem",
  pepe: "jose",
  rafa: "rafael",
  paco: "francisco",
  cora: "corazon",
  rody: "rodrigo",
  manny: "emmanuel",
  charo: "rosario",
  venky: "venkatesh",
  raj: "rajesh",
};

/** NICKNAMES as a Map: a lookup that is fast for any token and never reaches Object.prototype. */
const NICKNAME = new Map(Object.entries(NICKNAMES));

const CANON = new Map<string, string>();
for (const group of TRANSLIT)
  for (const spelling of group) CANON.set(spelling, group[0]);

// Normalisation --------------------------------------------------------------------------

function ascii(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[øØ]/g, "o")
    .replace(/[’`´]/g, "'")
    .toLowerCase();
}

/** Raw lowercase words; dots and apostrophes inside a word are dropped ("s.a." -> "sa"). */
function rawWords(text: string): string[] {
  return ascii(text)
    .replace(/&/g, " and ")
    .split(/[^a-z0-9.'-]+/)
    .map((w) => ocrFold(w.replace(/^[-.']+|[-']+$/g, "")))
    .filter(Boolean);
}

/**
 * Undoes common OCR confusions: digits inside a word read as letters
 * ("j0hn", "kestre1") and "rn" read as "m". Applied to both sides of every
 * comparison, so it only ever makes two forms equal, never apart.
 */
function ocrFold(word: string): string {
  const letters = /[a-z]/.test(word)
    ? word.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s")
    : word;
  return letters.replace(/rn/g, "m");
}

function stripHonorifics(words: string[]): string[] {
  let i = 0;
  while (i < words.length - 1 && HONORIFICS.has(words[i].replace(/\./g, "")))
    i++;
  return words.slice(i);
}

/** True when the string reads as a company, trust or foundation. */
export function isOrgLike(text: string): boolean {
  return rawWords(text).some((w) => ORG_WORDS.has(w.replace(/[.']/g, "")));
}

type PersonParts = { given: string[]; surname: string };

/** One comparable token: no particle prefix, no hyphens, dots or apostrophes. */
function token(word: string): string {
  return word
    .replace(/^(al|el|bin|ibn|van|de|d)-(?=[a-z]{2})/, "")
    .replace(/^d'(?=[a-z]{2})/, "")
    .replace(/[-.']/g, "");
}

/** Splits "A.L." into initials and drops particles. */
function nameTokens(words: string[]): string[] {
  const out: string[] = [];
  for (const word of words) {
    if (PARTICLES.has(word)) continue;
    if (/^([a-z]\.)+[a-z]?\.?$/.test(word) && word.length > 2) {
      for (const letter of word.replace(/\./g, "")) out.push(letter);
      continue;
    }
    // "j.okafor" (an email handle) reads as "j okafor".
    if (/^[a-z]+[._][a-z]+$/.test(word) && /[._]/.test(word)) {
      out.push(...word.split(/[._]/).map(token));
      continue;
    }
    const t = token(word);
    if (t) out.push(t);
  }
  return out;
}

function personParts(text: string): PersonParts | null {
  const comma = text.indexOf(",");
  if (comma > 0) {
    const left = nameTokens(stripHonorifics(rawWords(text.slice(0, comma))));
    const right = nameTokens(stripHonorifics(rawWords(text.slice(comma + 1))));
    if (left.length > 0 && right.length > 0)
      return { surname: left.join(""), given: right };
  }
  const tokens = nameTokens(stripHonorifics(rawWords(text)));
  if (tokens.length === 0) return null;
  return { surname: tokens[tokens.length - 1], given: tokens.slice(0, -1) };
}

function canonToken(t: string): string {
  return NICKNAME.get(t) ?? CANON.get(t) ?? t;
}

const skeletonCache = new Map<string, string>();

/** Consonant skeleton for unknown transliterations ("Mohamad" ~ "Muhammad"), memoised per token. */
function skeleton(t: string): string {
  let out = skeletonCache.get(t);
  if (out === undefined) {
    out = t
      .replace(/x/g, "ks")
      .replace(/ph/g, "f")
      .replace(/h$/, "")
      .replace(/[aeiouy]/g, "")
      .replace(/(.)\1+/g, "$1");
    if (skeletonCache.size > 50_000) skeletonCache.clear();
    skeletonCache.set(t, out);
  }
  return out;
}

function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (canonToken(a) === canonToken(b)) return true;
  if (a.length >= 4 && b.length >= 4 && a[0] === b[0]) {
    const sa = skeleton(a);
    if (sa.length >= 3 && sa === skeleton(b)) return true;
  }
  return false;
}

/** Jaro-Winkler similarity, 0..1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function givenCompatible(t: string, u: string): boolean {
  if (t.length === 1 || u.length === 1) return t[0] === u[0];
  return sameToken(t, u);
}

/** Every given name of the shorter list appears, in order, in the longer one. */
function givenMatch(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let j = 0;
  for (const t of short) {
    while (j < long.length && !givenCompatible(t, long[j])) j++;
    if (j === long.length) return false;
    j++;
  }
  return true;
}

function samePerson(a: PersonParts, b: PersonParts): boolean {
  const surnameSame = sameToken(a.surname, b.surname);
  if (a.given.length === 0 || b.given.length === 0) return surnameSame;
  if (!givenMatch(a.given, b.given)) return false;
  if (surnameSame) return true;
  // A typo in the surname, when the given names agree.
  return (
    Math.min(a.surname.length, b.surname.length) >= 5 &&
    jaroWinkler(a.surname, b.surname) >= 0.92
  );
}

/** Surname printed first without a comma ("CHEN Jiahui", "VOLKOV NATALIA"). */
function rotated(p: PersonParts): PersonParts | null {
  if (p.given.length === 0) return null;
  return { surname: p.given[0], given: [...p.given.slice(1), p.surname] };
}

type OrgParts = { core: string[]; legal: string[] };

function orgParts(text: string): OrgParts {
  const words = rawWords(text).map((w) => w.replace(/[.']/g, ""));
  while (
    words.length > 1 &&
    (words[0] === "the" || words[0] === "trustees" || words[0] === "of")
  )
    words.shift();
  const legal: string[] = [];
  while (words.length > 1 && LEGAL[words[words.length - 1]]) {
    legal.unshift(LEGAL[words.pop() as string]);
  }
  // "Pte. Ltd" and "S.A." split oddly; drop stray single letters at the end.
  return { core: words.map(token).filter(Boolean), legal };
}

function sameOrg(a: OrgParts, b: OrgParts): boolean {
  if (a.core.length === 0 || b.core.length === 0) return false;
  // Spaces too: a lost hyphen ("ferreira vos") is the same word.
  if (a.core.join("") === b.core.join("")) return true;
  if (a.core.length !== b.core.length) return false;
  let different = 0;
  for (let i = 0; i < a.core.length; i++) {
    const x = a.core[i];
    const y = b.core[i];
    if (x === y) continue;
    if (ORG_WORDS.has(x) || ORG_WORDS.has(y)) return false;
    if (Math.min(x.length, y.length) < 5 || jaroWinkler(x, y) < 0.9)
      return false;
    different++;
  }
  return different <= 1;
}

// Public API ----------------------------------------------------------------------------

/**
 * A key equal for forms that differ only in case, accents, punctuation,
 * titles, "SURNAME, Given" order and the spelling of a legal suffix.
 */
export function nameKey(text: string): string {
  if (isOrgLike(text)) {
    const { core, legal } = orgParts(text);
    return [...core, ...legal].join(" ");
  }
  const parts = personParts(text);
  if (!parts)
    return ascii(text)
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return [...parts.given, parts.surname].join(" ");
}

/**
 * Each printed form parsed once, with a person's readings: sameParty runs
 * for every pair of forms when a Register is matched against a key, so the
 * parse is a lookup after the first time.
 */
const partyCache = new Map<
  string,
  {
    org: boolean;
    person: PersonParts | null;
    readings: PersonParts[];
    orgParts: OrgParts | null;
  }
>();

function parse(text: string) {
  let parsed = partyCache.get(text);
  if (!parsed) {
    const org = isOrgLike(text);
    const person = org ? null : personParts(text);
    parsed = {
      org,
      person,
      readings: person ? readings(person) : [],
      orgParts: org ? orgParts(text) : null,
    };
    if (partyCache.size > 50_000) partyCache.clear();
    partyCache.set(text, parsed);
  }
  return parsed;
}

/**
 * True when two printed forms plausibly name the same party: case, accents,
 * punctuation, "SURNAME, Given" or surname-first order, initials, titles,
 * transliterations, nicknames and a one-letter slip in a long surname. A
 * company never matches a person, even a shell named like one.
 */
export function sameParty(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  if (x.org !== y.org) return false;
  if (x.org && x.orgParts && y.orgParts) return sameOrg(x.orgParts, y.orgParts);
  if (!x.person || !y.person) return false;
  return x.readings.some((l) => y.readings.some((r) => samePerson(l, r)));
}

/** Ways to read a person's tokens: as printed, surname first, or with a lost hyphen ("ferreira vos"). */
function readings(p: PersonParts): PersonParts[] {
  const out = [p];
  const r = rotated(p);
  if (r) out.push(r);
  if (p.given.length >= 2)
    out.push({
      surname: (p.given.at(-1) ?? "") + p.surname,
      given: p.given.slice(0, -1),
    });
  return out;
}

const forms = (name: ExtractedName) => [name.canonical, ...name.aliases];

/** A surname with no given name ("Mrs Okafor") can belong to several people. */
function isBare(text: string): boolean {
  const parsed = parse(text);
  return !parsed.org && (parsed.person?.given.length ?? 0) === 0;
}

function fullness(text: string): number {
  const parsed = parse(text);
  const tokens = parsed.org
    ? (parsed.orgParts?.core.length ?? 0) + (parsed.orgParts?.legal.length ?? 0)
    : (parsed.person?.given.length ?? 0) + 1;
  const words = rawWords(text);
  const titled =
    words.length > 0 && HONORIFICS.has(words[0].replace(/\./g, ""));
  const mixed = /\p{Lu}/u.test(text) && /\p{Ll}/u.test(text);
  const initials = parsed.person?.given.some((g) => g.length === 1) ?? false;
  return (
    tokens * 10 +
    (mixed ? 5 : 0) +
    (text.includes(",") ? 0 : 2) +
    (titled ? 0 : 1) +
    (initials ? 0 : 3)
  );
}

function fold(target: ExtractedName, incoming: ExtractedName): ExtractedName {
  const all = [...forms(target), ...forms(incoming)];
  let canonical = target.canonical;
  for (const form of all)
    if (fullness(form) > fullness(canonical)) canonical = form;
  const aliases = [...new Set(all)].filter((f) => f !== canonical);
  const seen = new Set<string>();
  const mentions = [...target.mentions, ...incoming.mentions]
    .filter((m) => {
      const key = `${m.page}\u0000${m.quote}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.page - b.page);
  const notes = [target.note, incoming.note].filter(Boolean);
  return {
    ...target,
    canonical,
    aliases,
    roles: [...new Set([...target.roles, ...incoming.roles])],
    mentions,
    confidence: Math.max(target.confidence, incoming.confidence),
    foundBy: [...new Set([...target.foundBy, ...incoming.foundBy])],
    note: notes.length > 0 ? [...new Set(notes)].join("; ") : undefined,
  };
}

function matches(a: ExtractedName, b: ExtractedName, resolveAliases: boolean) {
  const keysA = new Set(forms(a).map(nameKey));
  if (forms(b).some((f) => keysA.has(nameKey(f)))) return true;
  if (!resolveAliases) return false;
  return forms(a).some((x) => forms(b).some((y) => sameParty(x, y)));
}

/**
 * Folds incoming Names into the Register. With resolveAliases a Name joins
 * the entry it names under any alias; otherwise only on an exact nameKey. A
 * bare surname that fits several entries stays on its own, flagged.
 * Returns a new array; the inputs are not changed.
 */
export function mergeNames(
  register: ExtractedName[],
  incoming: ExtractedName[],
  rulebook: Rulebook,
): ExtractedName[] {
  const out = register.map((n) => ({ ...n }));
  for (const name of incoming) {
    const hits = out
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => matches(entry, name, rulebook.resolveAliases));
    if (hits.length === 0) {
      out.push({ ...name });
      continue;
    }
    if (hits.length > 1 && forms(name).every(isBare)) {
      out.push({
        ...name,
        note: [
          name.note,
          `ambiguous: could be ${hits.map((h) => h.entry.canonical).join(" or ")}`,
        ]
          .filter(Boolean)
          .join("; "),
      });
      continue;
    }
    out[hits[0].index] = fold(hits[0].entry, name);
  }
  return out;
}

const squash = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Applies the Rulebook to a list of Names: the exclude list (exact,
 * case-insensitive, on the canonical form or any alias), the entity types,
 * officials and dropBelow. Names under reviewBelow stay; they are only in doubt.
 */
export function applyRulebook(
  names: ExtractedName[],
  rulebook: Rulebook,
): ExtractedName[] {
  const excluded = new Set(rulebook.exclude.map(squash));
  return names.filter(
    (name) =>
      !forms(name).some((f) => excluded.has(squash(f))) &&
      rulebook.entityTypes.includes(name.type) &&
      name.confidence >= rulebook.dropBelow &&
      (rulebook.includeOfficials ||
        name.roles.length === 0 ||
        name.roles.some((r) => r !== "official")),
  );
}
