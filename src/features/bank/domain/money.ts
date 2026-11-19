/**
 * Money is a whole number of minor units (cents of a Meridian florin, MRF).
 * Never a float: every sum, fee and interest figure is integer arithmetic.
 * Play money only; Tidewater Bank and the florin are fictional.
 */
export const CURRENCY = "MRF";
export const CURRENCY_NAME = "Meridian florin";

/** The most one posting may carry: ten billion florins. Matches the table's check. */
export const MAX_AMOUNT = 1_000_000_000_000;

/** Whether a value is a usable amount: a positive safe integer within the cap. */
export function isAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_AMOUNT
  );
}

/** "1,234.50" for 123450. Negative amounts keep their sign. */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${cents}`;
}

/** "MRF 1,234.50". */
export function formatMoney(minor: number): string {
  return `${CURRENCY} ${formatMinor(minor)}`;
}

/**
 * Parses what a person types ("1,250", "1250.5", "MRF 12.34") into minor
 * units, or null when it is not an amount. Refuses more than two decimals
 * rather than rounding someone's money.
 */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/mrf/i, "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** floor(a * b / c) for non-negative integers, without leaving integers. */
export function mulDiv(a: number, b: number, c: number): number {
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/** a * b / c rounded half up, for non-negative integers. */
export function mulDivRound(a: number, b: number, c: number): number {
  const product = BigInt(a) * BigInt(b);
  const divisor = BigInt(c);
  return Number((product + divisor / BigInt(2)) / divisor);
}
