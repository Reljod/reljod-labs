/**
 * Account, customer, loan and card numbers. An account number is ten digits:
 * a two-digit product code, a seven-digit sequence and a Luhn check digit,
 * so a mistyped number is caught before any money moves.
 */
export const PRODUCT_CODE = {
  current: "10",
  savings: "20",
  term: "30",
  loan: "40",
  gl: "90",
} as const;

export type ProductKind = keyof typeof PRODUCT_CODE;

/** The Luhn check digit for a string of digits. */
export function luhnDigit(digits: string): number {
  let sum = 0;
  let double = true;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** Whether a string of digits ends in its own Luhn check digit. */
export function luhnValid(number: string): boolean {
  if (!/^\d{2,}$/.test(number)) return false;
  return luhnDigit(number.slice(0, -1)) === Number(number.at(-1));
}

export function accountNumber(kind: ProductKind, sequence: number): string {
  const body = `${PRODUCT_CODE[kind]}${String(sequence).padStart(7, "0")}`;
  return `${body}${luhnDigit(body)}`;
}

/** A Tidewater account number: ten digits, a known product code, a good check digit. */
export function isAccountNumber(value: string): boolean {
  return (
    /^\d{10}$/.test(value) &&
    Object.values(PRODUCT_CODE).includes(
      value.slice(0, 2) as (typeof PRODUCT_CODE)[ProductKind],
    ) &&
    luhnValid(value)
  );
}

/** "10 0000 0427" for reading aloud and for the screen. */
export function formatAccountNumber(number: string): string {
  return /^\d{10}$/.test(number)
    ? `${number.slice(0, 2)} ${number.slice(2, 6)} ${number.slice(6)}`
    : number;
}

export const customerNumber = (sequence: number) =>
  `C${String(sequence).padStart(6, "0")}`;

export const loanNumber = (sequence: number) =>
  `L${String(sequence).padStart(6, "0")}`;

/** Tidewater's own bank code on the Meridian clearing rail. */
export const TIDEWATER_BANK_CODE = "TDWM";

/** A bank code on the rail: four capital letters. */
export const isBankCode = (value: string) => /^[A-Z]{4}$/.test(value);

/**
 * The last four digits shown for a card. The full number is never made: the
 * card is a random token, and these four digits come from the sequence.
 */
export function cardLastFour(sequence: number): string {
  const body = String((sequence * 7919 + 1031) % 1000).padStart(3, "0");
  return `${body}${luhnDigit(`471200000000${body}`)}`;
}

export const maskedCard = (lastFour: string) => `•••• •••• •••• ${lastFour}`;
