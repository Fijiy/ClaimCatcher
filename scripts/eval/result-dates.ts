// Search results' dates, as TinyFish gives them: ISO dates, "Jun 10, 2026",
// or relative ones ("3 weeks ago", from the day searched). Shared by the
// search comparison (search-compare.ts) and the held-out set's leak filter
// (heldout.ts), which drop results dated after the day a claim was said.

export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const UNITS: Record<string, (d: Date, n: number) => void> = {
  second: (d, n) => d.setUTCSeconds(d.getUTCSeconds() - n),
  minute: (d, n) => d.setUTCMinutes(d.getUTCMinutes() - n),
  hour: (d, n) => d.setUTCHours(d.getUTCHours() - n),
  day: (d, n) => d.setUTCDate(d.getUTCDate() - n),
  week: (d, n) => d.setUTCDate(d.getUTCDate() - 7 * n),
  month: (d, n) => d.setUTCMonth(d.getUTCMonth() - n),
  year: (d, n) => d.setUTCFullYear(d.getUTCFullYear() - n),
};

/**
 * The days a search result's date can stand for, earliest and latest
 * (YYYY-MM-DD), or null if it can't be read. TinyFish gives ISO dates,
 * "Jun 10, 2026", or "2 weeks ago" (from the day searched, rounded down, so
 * "2 weeks ago" is 2 to 3 weeks before `searchedAt`).
 */
export function dateRange(published: string, searchedAt: Date): { lo: string; hi: string } | null {
  const text = published.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return { lo: text.slice(0, 10), hi: text.slice(0, 10) };
  const ago = text.toLowerCase().match(/^(an?|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (ago) {
    const n = /^\d/.test(ago[1]!) ? Number(ago[1]) : 1;
    const hi = new Date(searchedAt);
    UNITS[ago[2]!]!(hi, n);
    const lo = new Date(searchedAt);
    UNITS[ago[2]!]!(lo, n + 1);
    return { lo: iso(lo), hi: iso(hi) };
  }
  const named = text.match(/^([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})$/);
  if (named) {
    const month = MONTHS.indexOf(named[1]!.toLowerCase());
    if (month >= 0) {
      const day = iso(new Date(Date.UTC(Number(named[3]), month, Number(named[2]))));
      return { lo: day, hi: day };
    }
  }
  return null;
}

/** A result's date as the latest day it can be (YYYY-MM-DD), or null if it can't be read. */
export function absoluteDate(published: string, searchedAt: Date): string | null {
  return dateRange(published, searchedAt)?.hi ?? null;
}

/** Whether a result may be from after `date` (YYYY-MM-DD): false for an unreadable or missing date. */
export function mayBeAfter(published: string | null, date: string, searchedAt: Date): boolean {
  const range = published ? dateRange(published, searchedAt) : null;
  return range !== null && range.hi > date;
}
