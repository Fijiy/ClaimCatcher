// The search comparison behind `pnpm eval:search` (ticket #45): each search
// (Venice, TinyFish) runs the evaluation set's rated claims'
// two queries through the shipped adapter, and its results go through the
// shipped pipeline after search: link cleaning and classification, the
// balancing search when the would-be top 5 lean one way, and the top 5 at
// 400 characters. Measured per search: results returned, results usable
// after classification, the spread of the top 5 across L/LC/C/RC/R/Primary,
// how often the balancing search ran, latency, and overlap with the frozen
// evidence the verdict gate uses. Its evidence can then go to the verdict
// gate (search.ts does that with Gemini Nano).

import { searchOtherSide } from '../../src/session/checks/balance';
import { selectEvidence, type Evidence } from '../../src/session/checks/evidence';
import { failureKind, ProviderError, type SearchOptions, type SearchProvider, type SearchResult } from '../../src/session/checks/provider';
import type { ResultSet } from '../../src/session/checks/search';
import { classify } from '../../src/session/sources/classify';
import { cleanLink } from '../../src/session/sources/links';
import type { RatingsSnapshot } from '../../src/session/sources/ratings';
import type { SearchId } from '../../src/session/types';
import type { GateCase } from './eval-set';
import { mayBeAfter } from './result-dates';
import { quantile } from './score';

/** One rated claim's two queries, as the frozen evidence was searched (eval/verdicts/evidence/*.json). */
export interface SearchCase {
  id: string;
  /** The day the claim was said: results dated later are dropped, as for the frozen evidence. */
  date: string;
  /** B, the neutral fact query; A, the claim verbatim plus the speaker's surname. */
  queries: { fact: string; claim: string };
  /** The verdict gate's frozen top 5, for overlap. */
  frozen: Evidence[];
}

/** One search request as run. */
export interface Request {
  query: 'fact' | 'claim' | 'balance';
  ms: number;
  results: number;
  /** Why it failed after its one retry (the card's wording), if it did. */
  error?: string;
}

export interface ClaimRun {
  id: string;
  requests: Request[];
  /** Results returned by the two queries (before the date filter), and how many were dated after the claim. */
  returned: number;
  afterDate: number;
  /** How the returned results (after the date filter, duplicates once) classified. */
  classified: { full: number; reduced: number; context: number; dropped: number };
  /** The balancing search ran (the top 5 leaned one way). */
  balanced: boolean;
  /** The shipped selection's top 5, as the verdict step would get it. */
  evidence: Evidence[];
  /** Domains and cleaned links shared with the frozen top 5. */
  overlap: { domains: number; urls: number; frozen: number };
}

export type Spread = Record<'L' | 'LC' | 'C' | 'RC' | 'R' | 'Primary' | 'pro-science' | 'unrated', number>;

export interface SearchSummary {
  provider: SearchId;
  claims: number;
  requests: number;
  failedRequests: number;
  /** Failure reasons, counted. */
  failures: Record<string, number>;
  /** Results returned per query (mean), and queries that returned none. */
  resultsPerQuery: number;
  emptyQueries: number;
  /** Of the returned results (after the date filter, each link once): usable as evidence, and of those at full weight. */
  usable: number;
  usableFull: number;
  pool: number;
  /** Claims whose top 5 has 5, and 0, sources. */
  claimsWithFive: number;
  claimsWithNone: number;
  /** The top 5s' sources across the spectrum, all claims together. */
  spread: Spread;
  balancedClaims: number;
  latencyMs: { median: number; p90: number; max: number };
  /** Mean share of each claim's frozen top 5 also in this search's top 5, by domain and by link (claims with frozen evidence only). */
  overlapDomains: number;
  overlapUrls: number;
}

export interface CompareOptions {
  ratings: RatingsSnapshot;
  now?: () => number;
  /** When the searches run: relative result dates ("2 weeks ago") are read from it. */
  searchedAt?: Date;
  /** Waits this long between claims (live searches: be gentle). */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onClaim?: (index: number, run: ClaimRun) => void;
}

/** Runs every case's searches through `search` and the shipped selection. */
export async function compareSearch(cases: SearchCase[], search: SearchProvider, options: CompareOptions): Promise<ClaimRun[]> {
  const now = options.now ?? (() => performance.now());
  const searchedAt = options.searchedAt ?? new Date();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const runs: ClaimRun[] = [];
  for (const [index, c] of cases.entries()) {
    if (index > 0 && options.pauseMs) await sleep(options.pauseMs);
    const requests: Request[] = [];
    /** One request through the pipeline's own policy: retried once if it failed for any reason but the key. */
    const timed = (query: Request['query']) => ({
      async search(q: string, opts?: SearchOptions): Promise<SearchResult[]> {
        const start = now();
        const once = () => search.search(q, opts);
        try {
          let results: SearchResult[];
          try {
            results = await once();
          } catch (error) {
            if (failureKind(error) !== 'failed') throw error;
            results = await once();
          }
          requests.push({ query, ms: now() - start, results: results.length });
          return results;
        } catch (error) {
          requests.push({ query, ms: now() - start, results: 0, error: reason(error) });
          throw error;
        }
      },
    });
    const run = async (query: 'fact' | 'claim'): Promise<SearchResult[]> => {
      try {
        return await timed(query).search(c.queries[query]);
      } catch (error) {
        if (failureKind(error) !== 'failed') throw error; // a rejected key ends the comparison
        return [];
      }
    };
    const fact = await run('fact');
    const claim = await run('claim');
    // TinyFish dates come in several forms (result-dates.ts): a string comparison would drop every "Jun 1, 2024".
    const asOf = (r: SearchResult) => !mayBeAfter(r.published, c.date, searchedAt);
    const sets: ResultSet[] = [
      { query: 'fact', results: fact.filter(asOf) },
      { query: 'claim', results: claim.filter(asOf) },
    ];
    const firstPick = selectEvidence(sets, options.ratings).evidence;
    const balancing = await searchOtherSide(timed('balance'), c.queries, firstPick, options.ratings, (call) => call());
    if (balancing) balancing.results = balancing.results.filter(asOf);
    const all = balancing ? [...sets, balancing] : sets;
    const { evidence } = selectEvidence(all, options.ratings);
    const result: ClaimRun = {
      id: c.id,
      requests,
      returned: fact.length + claim.length,
      afterDate: fact.length + claim.length - sets[0]!.results.length - sets[1]!.results.length,
      classified: classifyPool(all, options.ratings),
      balanced: requests.some((r) => r.query === 'balance'),
      evidence,
      overlap: overlapOf(evidence, c.frozen),
    };
    runs.push(result);
    options.onClaim?.(index, result);
  }
  return runs;
}

function reason(error: unknown): string {
  return error instanceof ProviderError ? (error.why ?? error.message) : String(error);
}

function classifyPool(sets: ResultSet[], ratings: RatingsSnapshot): ClaimRun['classified'] {
  const counts = { full: 0, reduced: 0, context: 0, dropped: 0 };
  const seen = new Set<string>();
  for (const set of sets) {
    for (const result of set.results) {
      const url = cleanLink(result.url)?.url ?? result.url;
      if (seen.has(url)) continue;
      seen.add(url);
      const c = classify(url, ratings);
      if (c.use === 'dropped') counts.dropped++;
      else if (c.use === 'context') counts.context++;
      else if (c.weight === 'full') counts.full++;
      else counts.reduced++;
    }
  }
  return counts;
}

function overlapOf(evidence: Evidence[], frozen: Evidence[]): ClaimRun['overlap'] {
  // The same page: cleaned, with or without `www.`, http or https, a trailing slash or not.
  const link = (e: Evidence) => (cleanLink(e.url)?.url ?? e.url).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const domains = new Set(evidence.map((e) => e.domain));
  const urls = new Set(evidence.map(link));
  return {
    domains: new Set(frozen.map((e) => e.domain).filter((d) => domains.has(d))).size,
    urls: frozen.filter((e) => urls.has(link(e))).length,
    frozen: frozen.length,
  };
}

export function spreadOf(evidence: Evidence[]): Spread {
  const spread: Spread = { L: 0, LC: 0, C: 0, RC: 0, R: 0, Primary: 0, 'pro-science': 0, unrated: 0 };
  for (const { rating } of evidence) {
    if (rating.kind === 'primary') spread.Primary++;
    else if (rating.kind === 'unrated') spread.unrated++;
    else spread[rating.bias]++;
  }
  return spread;
}

export function summarize(provider: SearchId, runs: ClaimRun[]): SearchSummary {
  const requests = runs.flatMap((r) => r.requests);
  const queries = requests.filter((r) => r.query !== 'balance');
  const failures: Record<string, number> = {};
  for (const r of requests) if (r.error) failures[r.error] = (failures[r.error] ?? 0) + 1;
  const spread = spreadOf(runs.flatMap((r) => r.evidence));
  const pool = runs.reduce((n, r) => n + r.classified.full + r.classified.reduced + r.classified.context + r.classified.dropped, 0);
  const latencies = requests.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const withFrozen = runs.filter((r) => r.overlap.frozen > 0);
  const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
  return {
    provider,
    claims: runs.length,
    requests: requests.length,
    failedRequests: requests.filter((r) => r.error).length,
    failures,
    resultsPerQuery: mean(queries.map((r) => r.results)),
    emptyQueries: queries.filter((r) => !r.error && r.results === 0).length,
    usable: runs.reduce((n, r) => n + r.classified.full + r.classified.reduced, 0),
    usableFull: runs.reduce((n, r) => n + r.classified.full, 0),
    pool,
    claimsWithFive: runs.filter((r) => r.evidence.length === 5).length,
    claimsWithNone: runs.filter((r) => r.evidence.length === 0).length,
    spread,
    balancedClaims: runs.filter((r) => r.balanced).length,
    latencyMs: latencies.length === 0 ? { median: 0, p90: 0, max: 0 } : { median: quantile(latencies, 0.5), p90: quantile(latencies, 0.9), max: latencies.at(-1)! },
    overlapDomains: mean(withFrozen.map((r) => r.overlap.domains / r.overlap.frozen)),
    overlapUrls: mean(withFrozen.map((r) => r.overlap.urls / r.overlap.frozen)),
  };
}

/** The verdict gate's cases with this search's evidence in place of the frozen evidence. */
export function withEvidence(cases: GateCase[], runs: ClaimRun[]): GateCase[] {
  const byId = new Map(runs.map((r) => [r.id, r.evidence]));
  return cases.map((c) => ({ ...c, input: { ...c.input, evidence: byId.get(c.id) ?? [] } }));
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** A table of the summaries, one column per search. */
export function formatComparison(summaries: SearchSummary[]): string {
  const rows: Array<[string, (s: SearchSummary) => string]> = [
    ['Claims', (s) => String(s.claims)],
    ['Requests (failed)', (s) => `${s.requests} (${s.failedRequests})`],
    ['Results per query', (s) => s.resultsPerQuery.toFixed(1)],
    ['Queries with no results', (s) => String(s.emptyQueries)],
    ['Usable after classification', (s) => `${s.usable}/${s.pool} (${pct(s.pool ? s.usable / s.pool : 0)})`],
    ['… at full weight', (s) => String(s.usableFull)],
    ['Claims with 5 sources / none', (s) => `${s.claimsWithFive} / ${s.claimsWithNone}`],
    ['Top 5s: L LC C RC R', (s) => `${s.spread.L} ${s.spread.LC} ${s.spread.C} ${s.spread.RC} ${s.spread.R}`],
    ['Top 5s: Primary / unrated', (s) => `${s.spread.Primary} / ${s.spread.unrated}`],
    ['Balancing search ran', (s) => `${s.balancedClaims}/${s.claims}`],
    ['Latency median / p90 (ms)', (s) => `${Math.round(s.latencyMs.median)} / ${Math.round(s.latencyMs.p90)}`],
    ['Overlap with frozen: domains', (s) => pct(s.overlapDomains)],
    ['Overlap with frozen: links', (s) => pct(s.overlapUrls)],
  ];
  const head = ['', ...summaries.map((s) => s.provider)];
  const body = rows.map(([label, cell]) => [label, ...summaries.map(cell)]);
  const widths = head.map((_, i) => Math.max(...[head, ...body].map((row) => row[i]!.length)));
  const line = (row: string[]) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  ');
  const failures = summaries
    .filter((s) => Object.keys(s.failures).length > 0)
    .map((s) => `  ${s.provider}: ${Object.entries(s.failures).map(([why, n]) => `${n}× ${why}`).join('; ')}`);
  return [line(head), ...body.map(line), ...(failures.length ? ['Failures:', ...failures] : [])].join('\n');
}
