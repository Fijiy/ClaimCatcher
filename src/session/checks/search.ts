// Stage 2, search: runs a claim's queries through the provider's private
// search. Only these queries, written from the claim, go to search.

import type { ClaimQueries } from './breakdown';
import type { SearchProvider, SearchResult } from './provider';

/** The results of one query, in the provider's rank order. */
export interface ResultSet {
  /** Which query it answered; `balance` is the balancing search (balance.ts). */
  query: keyof ClaimQueries | 'balance';
  results: SearchResult[];
}

/**
 * Runs the fact query, then the claim query (both at once). `attempt` wraps
 * each request with the pipeline's retry policy.
 */
export async function searchClaim(
  search: SearchProvider,
  queries: ClaimQueries,
  attempt: <T>(call: () => Promise<T>) => Promise<T>,
): Promise<ResultSet[]> {
  const order: Array<keyof ClaimQueries> = ['fact', 'claim'];
  const distinct = order.filter((key, i) => queries[key] && order.findIndex((k) => queries[k] === queries[key]) === i);
  return Promise.all(distinct.map(async (query) => ({ query, results: await attempt(() => search.search(queries[query])) })));
}
