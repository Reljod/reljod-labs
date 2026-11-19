/**
 * What the harness can hear in a transcript without a model: whether a set of
 * phrases was said, and which language a Turn is in. Pure and deterministic,
 * so a Check that depends on it gives the same answer every time.
 */

/** Lowercase, no accents, words and digits only. "Días hábiles" becomes "dias habiles". */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9*]+/g, " ")
    .trim();
}

const tokens = (text: string) => {
  const clean = normalizeSpeech(text);
  return clean ? clean.split(" ") : [];
};

/** Whether one way of saying something (words in order, `*` ending a prefix) is in the text. */
function saysAlternative(words: string[], alternative: string): boolean {
  const pattern = tokens(alternative);
  if (pattern.length === 0) return false;
  for (let start = 0; start + pattern.length <= words.length; start++) {
    const hit = pattern.every((want, offset) => {
      const word = words[start + offset];
      return want.endsWith("*")
        ? want.length > 1 && word.startsWith(want.slice(0, -1))
        : word === want;
    });
    if (hit) return true;
  }
  return false;
}

/** Whether a line (`a|b|c`: any of these ways) was said. */
export function saysLine(text: string, line: string): boolean {
  const words = tokens(text.replace(/\*/g, " "));
  return line
    .split("|")
    .some((alternative) => saysAlternative(words, alternative));
}

/** Every line was said: a Disclosure. Returns the lines still missing. */
export function missingLines(text: string, lines: string[]): string[] {
  return lines.filter((line) => !saysLine(text, line));
}

/** Any line was said: a mention. Returns the first line that matched. */
export function mentionedLine(text: string, lines: string[]): string | null {
  return lines.find((line) => saysLine(text, line)) ?? null;
}

export type Language = "en" | "tl" | "es" | "tl-en" | "und";

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: "English",
  tl: "Tagalog",
  es: "Spanish",
  "tl-en": "Taglish",
  und: "",
};

const WORDS: Record<"en" | "tl" | "es", Set<string>> = {
  en: new Set(
    "the a an is are was were my i you to of and it in for on with that this have has want need train please thanks thank can could would what when where your not do does me booking they there been will about from just get got".split(
      " ",
    ),
  ),
  tl: new Set(
    "ang ng sa na ko mo po yung ako ikaw siya kami namin natin hindi oo opo salamat kasi lang naman ba pwede puwede may mga ito iyan yan dito saan kailan paano bakit gusto kailangan sandali kumusta magandang umaga hapon gabi ho kay din rin pa nasa wala meron kanina mamaya bukas lola naiwan tulong nang kung tayo sila niya nila akin iyo namin ano sino alin ganoon ganun talaga sige pala daw raw muna ulit pong nyo ninyo kayo natin tren ko'y po'y".split(
      " ",
    ),
  ),
  es: new Set(
    "el la los las de que y en un una es por con mi tu su se si pero como gracias hola buenos buenas dias tardes noches necesito quiero tengo puede puedo favor donde cuando estoy esta silla ruedas ayuda reserva billete manana usted muy bien del al lo le nos hay fue son soy tiene tren para porque tambien ahora".split(
      " ",
    ),
  ),
};

/**
 * The language of one Turn, by counting common words. Good enough to tag a
 * transcript line and to see a Caller switch; it decides nothing.
 */
export function detectLanguage(text: string): Language {
  const words = tokens(text);
  if (words.length === 0) return "und";
  const count = { en: 0, tl: 0, es: 0 };
  for (const word of words) {
    for (const language of ["en", "tl", "es"] as const) {
      if (WORDS[language].has(word)) count[language]++;
    }
  }
  const share = (language: "en" | "tl" | "es") =>
    count[language] / words.length;
  if (count.tl >= 2 && share("tl") >= 0.15) {
    return count.en >= 2 && share("en") >= 0.15 && count.es <= count.en
      ? "tl-en"
      : "tl";
  }
  if (count.es >= 2 && share("es") >= 0.2 && count.es > count.en) return "es";
  if (count.en >= 1 && count.en >= count.es && count.en >= count.tl)
    return "en";
  if (count.es >= 1 && count.es > count.tl) return "es";
  if (count.tl >= 1) return "tl";
  return "und";
}
