import { addMonths, type BankDate } from "./dates";
import { mulDivRound } from "./money";

/**
 * Loan arithmetic, all in whole minor units. Interest for a month is the
 * balance times the yearly rate over twelve, rounded half up; the level
 * payment is found by search so it never relies on floating point for the
 * figure a customer is charged.
 */

/** One month's interest on a balance. */
export function monthlyInterest(balance: number, rateBps: number): number {
  return mulDivRound(balance, rateBps, 120_000);
}

/** What is still owed after `months` level payments. Negative: overpaid. */
function owedAfter(
  principal: number,
  rateBps: number,
  months: number,
  payment: number,
): number {
  let balance = principal;
  for (let month = 0; month < months; month += 1) {
    balance = balance + monthlyInterest(balance, rateBps) - payment;
    if (balance <= 0) return balance;
  }
  return balance;
}

/** The smallest level monthly payment that clears the loan within its term. */
export function monthlyPayment(
  principal: number,
  rateBps: number,
  months: number,
): number {
  let low = Math.ceil(principal / months);
  let high = principal + monthlyInterest(principal, rateBps) + 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (owedAfter(principal, rateBps, months, middle) <= 0) high = middle;
    else low = middle + 1;
  }
  return low;
}

export type Instalment = {
  n: number;
  dueOn: BankDate;
  principal: number;
  interest: number;
  payment: number;
  balanceAfter: number;
};

/**
 * The amortisation schedule: level payments, the last one whatever is left,
 * so the principal parts add up to the loan exactly.
 */
export function amortise(
  principal: number,
  rateBps: number,
  months: number,
  disbursedOn: BankDate,
  payment = monthlyPayment(principal, rateBps, months),
): Instalment[] {
  const schedule: Instalment[] = [];
  let balance = principal;
  for (let n = 1; n <= months && balance > 0; n += 1) {
    const interest = monthlyInterest(balance, rateBps);
    const last = n === months || balance + interest <= payment;
    const pay = last ? balance + interest : payment;
    const principalPart = pay - interest;
    balance -= principalPart;
    schedule.push({
      n,
      dueOn: addMonths(disbursedOn, n),
      principal: principalPart,
      interest,
      payment: pay,
      balanceAfter: balance,
    });
  }
  return schedule;
}

/**
 * A deposit's annual rate as a daily rate: the annual percentage over 365,
 * shown to at most four decimal places ("0.0089%"). An account with no
 * interest rate has no daily rate, so it reads "Not available".
 */
export function formatDailyRate(rateBps: number): string {
  if (!Number.isFinite(rateBps) || rateBps <= 0) return "Not available";
  const daily = (rateBps / 100 / 365).toFixed(4).replace(/\.?0+$/, "");
  return daily === "0" ? "<0.0001%" : `${daily}%`;
}

/** Interest accrued on a deposit for one day, carrying the fraction of a cent. */
export const DAILY_DIVISOR = 3_650_000;

export function dailyInterest(
  balance: number,
  rateBps: number,
  carry: number,
): { amount: number; carry: number } {
  if (balance <= 0 || rateBps <= 0) return { amount: 0, carry };
  const numerator = BigInt(balance) * BigInt(rateBps) + BigInt(carry);
  const divisor = BigInt(DAILY_DIVISOR);
  return {
    amount: Number(numerator / divisor),
    carry: Number(numerator % divisor),
  };
}

/** Simple interest on a term deposit for its whole term, paid at maturity. */
export function termInterest(
  principal: number,
  rateBps: number,
  months: number,
): number {
  return mulDivRound(principal, rateBps * months, 120_000);
}
