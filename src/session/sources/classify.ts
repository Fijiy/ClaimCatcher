// Classifies one search result (spec "Sources"):
//
//   | Source                                         | Treatment                              |
//   |------------------------------------------------|----------------------------------------|
//   | MBFC VERY HIGH / HIGH                          | evidence, full weight                  |
//   | MBFC MIXED, and every other unrated site       | evidence, reduced weight               |
//   | MBFC LOW, fake-news, conspiracy, satire        | dropped: not evidence, not shown       |
//   | Primary source (bundled list, and any .edu)    | evidence, full weight, "Primary" pill  |
//   | User-generated source (bundled list)           | dropped                                |
//   | Partisan source (bundled list)                 | context: shown, never given to verdict |
//
// Primary sources (the bundled list and every `.edu` site) and user-generated
// sites win over MBFC. A partisan site is context with its MBFC rating, unless
// MBFC rates it LOW, fake-news, conspiracy or satire: the excluded rows win,
// so it isn't shown at all. Bias never changes the weight.

import type { Bias, Reliability, SourceRating, Weight } from '../types';
import { listOf } from './lists';
import { lookupMbfc, placeOf, type MbfcBiasKey, type MbfcEntry, type MbfcReporting, type RatingsSnapshot } from './ratings';

export type Classified =
  | { use: 'evidence'; rating: SourceRating; weight: Weight }
  | { use: 'context'; rating: SourceRating }
  | { use: 'dropped'; why: 'excluded' | 'user-generated' };

const BIAS: Partial<Record<MbfcBiasKey, Bias | 'pro-science'>> = {
  left: 'L',
  'left-center': 'LC',
  center: 'C',
  'right-center': 'RC',
  right: 'R',
  'pro-science': 'pro-science',
};

const RELIABILITY: Record<MbfcReporting, { reliability: Reliability; weight: Weight } | 'excluded'> = {
  'VERY HIGH': { reliability: 'very high', weight: 'full' },
  HIGH: { reliability: 'high', weight: 'full' },
  'MOSTLY FACTUAL': { reliability: 'mostly factual', weight: 'reduced' },
  MIXED: { reliability: 'mixed', weight: 'reduced' },
  LOW: 'excluded',
  'VERY LOW': 'excluded',
  FAKE: 'excluded',
};

export function classify(url: string, ratings: RatingsSnapshot): Classified {
  const place = placeOf(url);
  if (!place) return { use: 'dropped', why: 'excluded' };
  const listed = listOf(place.host);
  if (listed === 'user-generated') return { use: 'dropped', why: 'user-generated' };
  if (listed === 'primary' || place.host.endsWith('.edu')) return { use: 'evidence', rating: { kind: 'primary' }, weight: 'full' };

  const entry = lookupMbfc(ratings, place);
  const rated = entry ? fromMbfc(entry) : null;
  if (rated === 'excluded') return { use: 'dropped', why: 'excluded' };
  if (listed === 'partisan') return { use: 'context', rating: rated ? rated.rating : { kind: 'unrated' } };
  if (rated) return { use: 'evidence', ...rated };
  return { use: 'evidence', rating: { kind: 'unrated' }, weight: 'reduced' };
}

function fromMbfc(entry: MbfcEntry): { rating: SourceRating; weight: Weight } | 'excluded' {
  const bias = BIAS[entry.b];
  if (!bias) return 'excluded'; // fake-news, conspiracy, satire
  const reporting = entry.r ? RELIABILITY[entry.r] : { reliability: null, weight: 'reduced' as const };
  if (reporting === 'excluded') return 'excluded';
  return {
    rating: { kind: 'mbfc', bias, reliability: reporting.reliability, name: entry.n, page: entry.u },
    weight: reporting.weight,
  };
}
