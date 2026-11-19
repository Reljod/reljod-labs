/**
 * ISO 6346 container numbers: four letters (owner code and category), six
 * digits (serial) and one check digit. HARBOURMASTER never checks the digit;
 * the Guard does.
 */

/** A=10, B=12 ... Z=38: the alphabet from 10, skipping every multiple of 11. */
function letterValue(letter: string): number {
  let value = 10;
  for (let code = 65; code < letter.charCodeAt(0); code += 1) {
    value += 1;
    if (value % 11 === 0) value += 1;
  }
  return value;
}

/** The check digit for the first ten characters, or null when they are not 4 letters + 6 digits. */
export function checkDigit(first10: string): number | null {
  if (!/^[A-Z]{4}[0-9]{6}$/.test(first10)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const ch = first10[i];
    const value = i < 4 ? letterValue(ch) : Number(ch);
    sum += value * 2 ** i;
  }
  // A remainder of 10 is written as 0.
  return (sum % 11) % 10;
}

/** Strips spaces and dashes and upper-cases: `mrdu 482113-1` becomes `MRDU4821131`. */
export function normaliseContainer(text: string): string {
  return text.replace(/[\s-]+/g, "").toUpperCase();
}

/** Exactly 11 characters, already normalised, with the right check digit. */
export function isValidContainer(container: string): boolean {
  if (!/^[A-Z]{4}[0-9]{7}$/.test(container)) return false;
  return checkDigit(container.slice(0, 10)) === Number(container[10]);
}

/** Builds a full container number from an owner code and a six-digit serial. */
export function containerNumber(owner: string, serial: string): string {
  const digit = checkDigit(`${owner}${serial}`);
  if (digit === null) return `${owner}${serial}`;
  return `${owner}${serial}${digit}`;
}

/** `MRDU4821131` as it is printed on the box and on paper: `MRDU 482113 1`. */
export function spacedContainer(container: string): string {
  return `${container.slice(0, 4)} ${container.slice(4, 10)} ${container.slice(10)}`;
}
