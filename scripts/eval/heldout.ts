// The held-out accuracy set (eval/heldout/, see its README): recent US
// political claims rated by PolitiFact, none of them in the 29-claim gate,
// the prompt never tuned on them. This file holds what both commands share:
// the rating mapping, the searches for a claim, the leak filter, freezing a
// claim's evidence through the shipped search path, and the cases the
// shipped verdict step gets.
//
//   pnpm eval:heldout-evidence   freezes the evidence (TinyFish), once
//   pnpm eval:heldout            the verdicts on Gemini Nano, from the frozen evidence

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchOtherSide } from '../../src/session/checks/balance';
import { selectEvidence, type Evidence } from '../../src/session/checks/evidence';
import { failureKind, ProviderError, type SearchOptions, type SearchProvider, type SearchResult } from '../../src/session/checks/provider';
import type { ResultSet } from '../../src/session/checks/search';
import { factCheckerOf } from '../../src/session/sources/fact-checkers';
import type { RatingsSnapshot } from '../../src/session/sources/ratings';
import type { Label } from '../../src/session/types';
import { ROOT } from './cli';
import type { GateCase } from './eval-set';
import { absoluteDate, dateRange, MONTHS } from './result-dates';

export { absoluteDate, dateRange } from './result-dates';

export type PublisherRating = 'True' | 'Mostly True' | 'Half True' | 'Mostly False' | 'False' | 'Pants on Fire';
type Truth = Exclude<Label, 'Unverified'>;

/** One claim of eval/heldout/claims.json. */
export interface HeldoutClaim {
  /** `pf/<speaker slug>/<fact-check slug>`, from the fact-check's link. */
  id: string;
  /** The claim as the fact-checker stated it (a leading "Says" dropped). */
  claim: string;
  speaker: string;
  /** The day it was said (YYYY-MM-DD): the judged-as-of date. */
  said: string;
  /** Where it was said, as the fact-checker gave it ("an ad", "a debate"). */
  venue: string;
  factCheck: { publisher: 'PolitiFact'; url: string; published: string; authors: string[]; rating: PublisherRating };
  label: Truth;
  basis: 'firm' | 'judgment';
  /** For a judgment mapping: why, in a sentence (not the fact-checker's words). */
  mappingNote?: string;
}

const FIRM: Partial<Record<PublisherRating, Truth>> = {
  True: 'True',
  'Mostly True': 'True',
  'Half True': 'Misleading',
  False: 'False',
  'Pants on Fire': 'False',
};

/**
 * eval/README.md's mapping: True and Mostly True → True, Half True →
 * Misleading, False and Pants on Fire → False, all firm. Mostly False is
 * Misleading if the literal fact is about right but the impression wrong,
 * else False: a judgment from the fact-check, which must be given.
 */
export function mapRating(rating: PublisherRating, judgment?: 'Misleading' | 'False'): { label: Truth; basis: 'firm' | 'judgment' } {
  const firm = FIRM[rating];
  if (firm) return { label: firm, basis: 'firm' };
  if (!judgment) throw new Error(`${rating} maps by judgment: give Misleading or False`);
  return { label: judgment, basis: 'judgment' };
}

/**
 * The two searches, a stand-in for claim breakdown's (not run here, as in the
 * 29-claim gate): the claim's own words without quote marks as the fact
 * query, and the same plus the speaker's name as the claim query.
 */
export function queriesFor(c: HeldoutClaim): { fact: string; claim: string } {
  const words = c.claim.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  return { fact: words, claim: `${words} ${c.speaker}` };
}

export type DropReason = 'fact-checker' | 'fact-check-words' | 'after-said' | 'maybe-after-said' | 'after-said-link-date' | 'undated';
export const DROP_REASONS: readonly DropReason[] = ['fact-checker', 'fact-check-words', 'after-said', 'maybe-after-said', 'after-said-link-date', 'undated'];

const FACT_CHECK_WORDS = /fact[\s-]?check|politifact|truth-o-meter|pants on fire/i;

/** The date a link's path carries, as YYYY-MM-DD or YYYY-MM, if it has one. */
function linkDate(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const two = (n: string) => n.padStart(2, '0');
  const ymd = path.match(/(?:^|[/_-])(20\d\d)[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?=$|[/_.-])/);
  if (ymd) return `${ymd[1]}-${two(ymd[2]!)}-${two(ymd[3]!)}`;
  const named = path.match(/\/(20\d\d)\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\/(\d{1,2})\//);
  if (named) return `${named[1]}-${two(String(MONTHS.indexOf(named[2]!) + 1))}-${two(named[3]!)}`;
  const ym = path.match(/\/(20\d\d)\/(0?[1-9]|1[0-2])\//);
  if (ym) return `${ym[1]}-${two(ym[2]!)}`;
  return null;
}

/**
 * Why a search result can't be evidence for a claim said on `said`, or null:
 * a professional fact-checker on the product's list (the answer itself), a
 * page that calls itself a fact-check or quotes a fact-checker's rating, a
 * result dated after the day said (or whose relative date, read from
 * `searchedAt`, may be), an undated one whose link carries a later date, or
 * one with no date at all: searched months later, an undated page (a copy
 * of the fact-check on an aggregator, a since-edited Wikipedia article, a
 * live data table) can't be shown to predate the claim. The day said itself
 * is kept, as in the 29-claim gate.
 */
export function leakReason(result: SearchResult, said: string, searchedAt = new Date()): DropReason | null {
  if (factCheckerOf(result.url)) return 'fact-checker';
  if (FACT_CHECK_WORDS.test(result.title) || FACT_CHECK_WORDS.test(result.snippet) || FACT_CHECK_WORDS.test(safePath(result.url))) return 'fact-check-words';
  const range = result.published ? dateRange(result.published, searchedAt) : null;
  if (range) return range.lo > said ? 'after-said' : range.hi > said ? 'maybe-after-said' : null;
  const date = linkDate(result.url);
  if (!date) return 'undated';
  if (date > said.slice(0, date.length)) return 'after-said-link-date';
  return null;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

type QueryName = 'fact' | 'claim' | 'balance';

/** One claim's frozen evidence: eval/heldout/evidence/<id>.json. */
export interface EvidencePack {
  id: string;
  said: string;
  queries: { fact: string; claim: string };
  requests: Array<{ query: QueryName; ms: number; results: number; error?: string }>;
  /** Every result, in rank order per query; dropped ones keep no snippet. */
  results: Array<{
    query: QueryName;
    rank: number;
    title: string;
    url: string;
    domain: string;
    /** As an absolute day (YYYY-MM-DD) when TinyFish gave a relative one ("2 weeks ago"). */
    published: string | null;
    /** TinyFish's own words for the date, when they were relative or another form. */
    publishedAsGiven?: string;
    snippet?: string;
    dropped?: DropReason;
  }>;
  /** Results the searches returned, the balancing search's included. */
  returned: number;
  dropped: Record<DropReason, number>;
  /** Kept results dated only by their link. */
  linkDatedKept: number;
  /** When the searches ran: relative dates are read from it. */
  searchedAt: string;
  balanced: boolean;
  /** A search failed after its retry. */
  failed: boolean;
  /** Exactly what the verdict step is given (the shipped selection's top 5). */
  evidence: Evidence[];
}

/**
 * Runs a claim's two searches through `search` with the pipeline's one
 * retry, drops leaks (leakReason), runs the shipped balancing search when
 * the would-be top 5 lean one way (its results filtered the same way), and
 * keeps the shipped selection's top 5. A failed search leaves its query
 * empty, as a live check would go on with what it has.
 */
export async function freezeEvidence(
  c: HeldoutClaim,
  search: SearchProvider,
  ratings: RatingsSnapshot,
  options: {
    now?: () => number;
    searchedAt?: Date;
    /**
     * Re-filter this earlier pack instead of searching again: its fact and
     * claim results are replayed (as TinyFish gave them, read from its
     * search time, its drops kept) and only a balancing search goes out.
     */
    earlier?: EvidencePack;
  } = {},
): Promise<EvidencePack> {
  const { now = () => performance.now(), earlier } = options;
  const searchedAt = earlier ? new Date(earlier.searchedAt) : (options.searchedAt ?? new Date());
  const queries = queriesFor(c);
  const requests: EvidencePack['requests'] = [];
  const results: EvidencePack['results'] = [];
  const dropped = Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>;
  let linkDatedKept = 0;

  // Kept results go on with an absolute date, so "2 weeks ago" reads right as of the day said.
  const keep = (query: QueryName, found: SearchResult[]): SearchResult[] =>
    found.flatMap((r, i) => {
      const before = earlier && query !== 'balance' ? earlier.results.find((e) => e.query === query && e.rank === i + 1)?.dropped : undefined;
      const why = before ?? leakReason(r, c.said, searchedAt);
      const day = r.published ? absoluteDate(r.published, searchedAt) : null;
      const published = day ?? r.published;
      const { snippet, ...rest } = r;
      results.push({ query, rank: i + 1, ...rest, published, ...(published !== r.published ? { publishedAsGiven: r.published! } : {}), ...(why ? { dropped: why } : { snippet }) });
      if (why) {
        dropped[why]++;
        return [];
      }
      if (!day) linkDatedKept++;
      return [{ ...r, published }];
    });
  const timed = (query: QueryName): SearchProvider => ({
    async search(q: string, opts?: SearchOptions) {
      const start = now();
      const once = () => search.search(q, opts);
      try {
        let found: SearchResult[];
        try {
          found = await once();
        } catch (error) {
          if (failureKind(error) !== 'failed') throw error;
          found = await once();
        }
        requests.push({ query, ms: now() - start, results: found.length });
        return keep(query, found);
      } catch (error) {
        requests.push({ query, ms: now() - start, results: 0, error: error instanceof ProviderError ? (error.why ?? error.message) : String(error) });
        throw error;
      }
    },
  });
  const replay = (query: 'fact' | 'claim'): SearchResult[] => {
    const asked = earlier!.requests.find((r) => r.query === query);
    if (asked) requests.push(asked);
    return keep(
      query,
      earlier!.results
        .filter((r) => r.query === query)
        .sort((a, b) => a.rank - b.rank)
        .map(({ title, url, domain, published, publishedAsGiven, snippet }) => ({ title, url, domain, snippet: snippet ?? '', published: publishedAsGiven ?? published })),
    );
  };
  const run = async (query: 'fact' | 'claim') => {
    if (earlier) return replay(query);
    try {
      return await timed(query).search(queries[query]);
    } catch (error) {
      if (failureKind(error) !== 'failed') throw error; // a rejected key stops the freeze
      return [];
    }
  };

  const sets: ResultSet[] = [
    { query: 'fact', results: await run('fact') },
    { query: 'claim', results: await run('claim') },
  ];
  const firstPick = selectEvidence(sets, ratings).evidence;
  const balancing = await searchOtherSide(timed('balance'), queries, firstPick, ratings, (call) => call());
  const { evidence } = selectEvidence(balancing ? [...sets, balancing] : sets, ratings);
  return {
    id: c.id,
    said: c.said,
    queries,
    requests,
    results,
    returned: requests.reduce((n, r) => n + r.results, 0),
    dropped,
    linkDatedKept,
    searchedAt: searchedAt.toISOString(),
    balanced: requests.some((r) => r.query === 'balance'),
    failed: requests.some((r) => r.error !== undefined),
    evidence,
  };
}

/** The claims' gate cases, each given its frozen evidence. */
export function heldoutCases(claims: HeldoutClaim[], packs: Map<string, EvidencePack>): GateCase[] {
  return claims.map((c): GateCase => {
    const pack = packs.get(c.id);
    if (!pack) throw new Error(`${c.id} has no frozen evidence: run pnpm eval:heldout-evidence first`);
    return {
      id: c.id,
      clip: 'heldout',
      date: c.said,
      truth: c.label,
      accept: [c.label],
      basis: c.basis,
      input: {
        literal: c.claim,
        implied: '',
        context: '',
        title: `${c.speaker} in ${c.venue}`,
        speaker: c.speaker,
        evidence: pack.evidence,
        judgedAsOf: c.said,
        // The day said, so time words ("now", "in 48 years") count from it (#46).
        saidOn: c.said,
      },
    };
  });
}

export const HELDOUT_DIR = join(ROOT, 'eval', 'heldout');
export const evidencePath = (id: string) => join(HELDOUT_DIR, 'evidence', `${id.replace(/\//g, '__')}.json`);

export function loadHeldoutClaims(): HeldoutClaim[] {
  return JSON.parse(readFileSync(join(HELDOUT_DIR, 'claims.json'), 'utf8')) as HeldoutClaim[];
}

export function loadEvidencePacks(): Map<string, EvidencePack> {
  const dir = join(HELDOUT_DIR, 'evidence');
  const packs = new Map<string, EvidencePack>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const pack = JSON.parse(readFileSync(join(dir, name), 'utf8')) as EvidencePack;
    packs.set(pack.id, pack);
  }
  return packs;
}
