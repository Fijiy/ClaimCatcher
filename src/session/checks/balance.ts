// Stage 2b, the balancing search (spec "Search"): when every rated source in
// the would-be top 5 has a bias rating on one side, one more search runs,
// aimed at outlets from the other side and Center. Its results join the pool
// as a set of their own, and the top 5 are chosen again (evidence.ts).
//
// Bias is used for this and nothing else: no outlet is dropped or counts less
// for its bias rating. Primary, pro-science, unrated and partisan sources
// have no side.

import type { Bias } from '../types';
import { classify } from '../sources/classify';
import type { RatingsSnapshot } from '../sources/ratings';
import type { ClaimQueries } from './breakdown';
import type { Evidence } from './evidence';
import { failureKind, type SearchProvider, type SiteFilter } from './provider';
import type { ResultSet } from './search';

export type Side = 'left' | 'right';

const SIDE: Record<Bias, Side | null> = { L: 'left', LC: 'left', C: null, RC: 'right', R: 'right' };

/**
 * Well-known national outlets a balancing search can aim at. Each one's side
 * comes from the ratings data, not from this list, and only outlets the data
 * rates at full weight are used.
 */
const OUTLETS = [
  // Usually Center
  'apnews.com',
  'reuters.com',
  'usatoday.com',
  'csmonitor.com',
  'economist.com',
  // Usually right of center
  'wsj.com',
  'realclearpolitics.com',
  'washingtonexaminer.com',
  'nationalreview.com',
  'reason.com',
  'washingtontimes.com',
  // Usually left of center
  'nytimes.com',
  'washingtonpost.com',
  'npr.org',
  'nbcnews.com',
  'politico.com',
  'theatlantic.com',
  'vox.com',
];

/** How many outlets of each kind (Center, other side) one search names. */
const PER_KIND = 4;

/**
 * Runs the balancing search when `evidence` (the top 5 without it) is
 * one-sided, and returns its results as a set, or null when none was needed
 * or it failed. A failed balancing search (after its retry) doesn't fail the
 * check: the verdict is weighed on what was found. A rejected key or no credit
 * still ends it.
 */
export async function searchOtherSide(
  search: SearchProvider,
  queries: ClaimQueries,
  evidence: Evidence[],
  ratings: RatingsSnapshot,
  attempt: <T>(call: () => Promise<T>) => Promise<T>,
): Promise<ResultSet | null> {
  const side = oneSide(evidence);
  const sites = side && balancingSites(side, ratings);
  if (!sites) return null;
  const query = queries.fact || queries.claim;
  try {
    return { query: 'balance', results: await attempt(() => search.search(query, { sites })) };
  } catch (error) {
    if (failureKind(error) !== 'failed') throw error;
    return null;
  }
}

/** The side every rated source is on, or null when they aren't all on one side (or none is rated). */
export function oneSide(evidence: Evidence[]): Side | null {
  let side: Side | null = null;
  for (const { rating } of evidence) {
    if (rating.kind !== 'mbfc' || rating.bias === 'pro-science') continue;
    const here = SIDE[rating.bias];
    if (!here || (side && here !== side)) return null;
    side = here;
  }
  return side;
}

/**
 * What the balancing search aims at: outlets the ratings place at Center or
 * on the other side, up to 4 of each. Null when the ratings leave no such
 * outlet to aim at. Each search turns them into its own filter (Venice:
 * `site:` operators; TinyFish: a domain list).
 */
export function balancingSites(side: Side, ratings: RatingsSnapshot): SiteFilter | null {
  const center: string[] = [];
  const otherSide: string[] = [];
  for (const domain of OUTLETS) {
    const classified = classify(`https://${domain}/`, ratings);
    if (classified.use !== 'evidence' || classified.weight !== 'full' || classified.rating.kind !== 'mbfc') continue;
    const { bias } = classified.rating;
    if (bias === 'pro-science') continue;
    const at = SIDE[bias];
    if (at === null && center.length < PER_KIND) center.push(domain);
    else if (at !== null && at !== side && otherSide.length < PER_KIND) otherSide.push(domain);
  }
  if (center.length + otherSide.length === 0) return null;
  return { center, otherSide };
}
