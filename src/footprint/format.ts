// How the footer writes the estimator's ranges ("1.6–14", "12–25¢").

import type { Range } from './estimate';

/** Two significant figures below 10, whole numbers from 10. */
export function formatAmount(n: number): string {
  if (!(n > 0)) return '0';
  if (n >= 10) return String(Math.round(n));
  return String(Number(n.toPrecision(2)));
}

/** "low–high", or one figure when both ends write the same. */
export function formatRange(range: Range, amount: (n: number) => string = formatAmount): string {
  const low = amount(range.low);
  const high = amount(range.high);
  return low === high ? low : `${low}–${high}`;
}

/** Cost from cents: "12–25¢" up to a dollar, "$1.20–2.51" from there. */
export function formatCost(cents: Range): string {
  if (cents.high < 100) return `${formatRange(cents)}¢`;
  return `$${formatRange({ low: cents.low / 100, high: cents.high / 100 }, (n) => n.toFixed(2))}`;
}
