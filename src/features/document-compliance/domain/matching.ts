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
 * True when `word` is one or more of the given names, each written in full or as
 * its initial, in declared order. Covers OCR runs such as "amaralucia" and "amaral".
 */
function madeOfGivenNames(word: string, givenNames: string[]): boolean {
  if (word === "") return true;
  return givenNames.some((name, index) =>
    [name, name[0]].some(
      (piece) =>
        word.startsWith(piece) &&
        madeOfGivenNames(word.slice(piece.length), givenNames.slice(index + 1)),
    ),
  );
}

/**
 * True when a name on a Document can belong to the declared person: the surname
 * (last declared word) appears, and every other word is made of declared given
 * names or their initials. Middle names may be left out.
 */
export function namesCompatible(documentName: string, declaredName: string) {
  const declared = words(declaredName);
  const found = words(documentName);
  const surname = declared.at(-1);
  if (!surname || !found.includes(surname)) return false;

  const givenNames = declared.slice(0, -1);
  const otherWords = found.filter((word) => word !== surname);
  if (otherWords.length === 0) return false;

  return otherWords.every((word) => madeOfGivenNames(word, givenNames));
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
