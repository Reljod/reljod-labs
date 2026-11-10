/** 32 symbols that survive being read aloud: no 0 or O, no 1 or I. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 12;
const GROUP = 4;

/**
 * A Guest code from random bytes: 12 symbols of 5 bits each, 60 bits in all.
 * 256 is a multiple of 32, so taking a byte modulo 32 is unbiased.
 */
export function guestCodeFrom(bytes: Uint8Array) {
  if (bytes.length < CODE_LENGTH) throw new Error("Not enough random bytes");
  const symbols = Array.from(
    bytes.slice(0, CODE_LENGTH),
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  );
  return formatGuestCode(symbols.join(""));
}

/** `ABCDEFGHJKMN` as `ABCD-EFGH-JKMN`, the way a Host reads it out. */
export function formatGuestCode(code: string) {
  return code.match(new RegExp(`.{1,${GROUP}}`, "g"))?.join("-") ?? code;
}

/**
 * What a Guest typed, as the bare code: case, spaces and dashes do not matter.
 * Null when it cannot be a Guest code, so it is never looked up.
 */
export function normalizeGuestCode(input: string) {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((symbol) => CODE_ALPHABET.includes(symbol))
    ? code
    : null;
}
