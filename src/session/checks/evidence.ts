// Stage 3, evidence selection: cleans every search result's link (see
// ../sources/links.ts) and classifies it by its final domain (see
// ../sources/classify.ts), drops what may never be evidence, sets partisan
// sources aside as context, and picks the top 5 at 400 characters each.
// Full-weight sources come first; within each weight the picks alternate
// between queries (fact, claim, fact, …). This is all of the web the verdict
// step sees.

import type { ContextSource, SourceRating, Weight } from '../types';
import { classify } from '../sources/classify';
import { factCheckerOf } from '../sources/fact-checkers';
import { cleanLink } from '../sources/links';
import type { RatingsSnapshot } from '../sources/ratings';
import type { SearchResult } from './provider';
import type { ResultSet } from './search';

export const EVIDENCE_COUNT = 5;
export const SNIPPET_CHARS = 400;
/** At most this many partisan sources are shown for context. */
export const CONTEXT_COUNT = 3;

/** A source as the verdict step sees it, numbered from 1. */
export interface Evidence extends SearchResult {
  n: number;
  rating: SourceRating;
  weight: Weight;
  /** The professional fact-checker that published it, if one did. Card only: the verdict step isn't told. */
  factCheck?: string;
}

export interface Selection {
  evidence: Evidence[];
  /** Partisan sources: for the card only. */
  context: ContextSource[];
}

type Candidate = Omit<Evidence, 'n'>;

export function selectEvidence(
  sets: ResultSet[],
  ratings: RatingsSnapshot,
  count = EVIDENCE_COUNT,
  chars = SNIPPET_CHARS,
): Selection {
  const context: ContextSource[] = [];
  const contextSeen = new Set<string>();
  const queues = sets.map((set) =>
    set.results.flatMap((found): Candidate[] => {
      const link = cleanLink(found.url);
      if (!link) return [];
      const result = { ...found, ...link };
      const classified = classify(result.url, ratings);
      if (classified.use === 'evidence') {
        const factCheck = factCheckerOf(result.url);
        return [{ ...result, rating: classified.rating, weight: classified.weight, ...(factCheck ? { factCheck } : {}) }];
      }
      if (classified.use === 'context' && !contextSeen.has(sameDocument(result.url)) && context.length < CONTEXT_COUNT) {
        contextSeen.add(sameDocument(result.url));
        context.push({ ...result, snippet: trim(result.snippet, chars), rating: classified.rating });
      }
      return [];
    }),
  );

  const picked: Evidence[] = [];
  const seen = new Set<string>();
  for (const weight of ['full', 'reduced'] as const) {
    const pending = queues.map((queue) => queue.filter((c) => c.weight === weight));
    while (picked.length < count && pending.some((q) => q.length > 0)) {
      for (const queue of pending) {
        if (picked.length >= count) break;
        // Take this query's best result not already picked by another query.
        for (let result = queue.shift(); result; result = queue.shift()) {
          const key = sameDocument(result.url);
          if (seen.has(key)) continue;
          seen.add(key);
          picked.push({ ...result, n: picked.length + 1, snippet: trim(result.snippet, chars) });
          break;
        }
      }
    }
  }
  return { evidence: picked, context };
}

function trim(text: string, chars: number): string {
  if (text.length <= chars) return text;
  return `${text.slice(0, chars - 1).trimEnd()}…`;
}

/** The same page reached by two queries counts once: ignore scheme, `www.`, fragment and a trailing slash. */
function sameDocument(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url;
  }
}
