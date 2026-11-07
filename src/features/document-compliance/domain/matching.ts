/** Lowercase, accent-free words, so "VALDÉS-Ruiz, A." and "valdes ruiz a" compare equal. */
export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * True when a name on a Document can belong to the declared person: the surname
 * (last declared word) appears, and every other word is a declared given name or
 * its initial. Middle names may be left out.
 */
export function namesCompatible(documentName: string, declaredName: string) {
  const declared = words(declaredName);
  const found = words(documentName);
  const surname = declared.at(-1);
  if (!surname || !found.includes(surname)) return false;

  const givenNames = declared.slice(0, -1);
  const otherWords = found.filter((word) => word !== surname);
  if (otherWords.length === 0) return false;

  return otherWords.every((word) =>
    givenNames.some((given) =>
      word.length === 1 ? given.startsWith(word) : given === word,
    ),
  );
}

const COUNTRY_WORDS = new Set(["republic", "of", "meridia"]);

/** True when every word of the address on the Document appears in the declared address. */
export function addressesCompatible(
  documentAddress: string,
  declaredAddress: string,
) {
  const declared = new Set(words(declaredAddress));
  const found = words(documentAddress).filter(
    (word) => !COUNTRY_WORDS.has(word),
  );
  return found.length > 0 && found.every((word) => declared.has(word));
}
