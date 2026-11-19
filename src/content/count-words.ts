const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

/**
 * A count in words, the way the site's copy writes it ("twelve",
 * "twenty-one"). Past ninety-nine it falls back to digits.
 */
export function countWord(count: number): string {
  if (!Number.isInteger(count) || count < 0 || count > 99) {
    return String(count);
  }
  if (count < WORDS.length) return WORDS[count];
  const ones = count % 10;
  const tens = TENS[Math.floor(count / 10)];
  return ones === 0 ? tens : `${tens}-${WORDS[ones]}`;
}

/** `countWord` with a capital, to start a sentence or a title. */
export function capitalCountWord(count: number): string {
  const word = countWord(count);
  return word.charAt(0).toUpperCase() + word.slice(1);
}
