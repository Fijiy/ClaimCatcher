// The search comparison's measures (`pnpm eval:search`), on the shipped
// adapters over fake searches: expected values are worked out by hand from
// the scripted results.

import { describe, expect, it } from 'vitest';
import { createTinyFishSearch } from '../../src/session/checks/tinyfish';
import { createFakeTinyFish } from '../../src/session/testing/fake-search';
import { fakeRatings } from '../../src/session/testing/fake-ratings';
import { compareSearch, summarize, type SearchCase } from './search-compare';

const RATINGS = fakeRatings({
  'apnews.com': ['center', 'HIGH'],
  'wsj.com': ['right-center', 'HIGH'],
  'vox.com': ['left', 'HIGH'],
  'mixed.example': ['left', 'MIXED'],
});

const frozen = (domain: string) => ({
  n: 1,
  title: domain,
  url: `https://${domain}/a`,
  domain,
  snippet: '',
  published: null,
  rating: { kind: 'unrated' as const },
  weight: 'reduced' as const,
  query: 'fact' as const,
});

const CASES: SearchCase[] = [
  { id: 'clip#1', date: '2024-06-27', queries: { fact: 'fact one', claim: 'claim one' }, frozen: [frozen('bls.gov'), frozen('apnews.com')] },
  { id: 'clip#2', date: '2024-06-27', queries: { fact: 'fact two', claim: 'claim two' }, frozen: [] },
];

describe('the search comparison', () => {
  it('measures results, classification, balancing, overlap and failures through the shipped adapter and selection', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onSearch((query, params) => {
      if (params.has('include_domains')) return [{ title: 'AP', url: 'https://apnews.com/b', snippet: 'Center take.' }];
      if (query === 'fact one')
        return [
          { title: 'BLS', url: 'https://www.bls.gov/a', snippet: 'Primary.' },
          { title: 'Vox', url: 'https://vox.com/a', snippet: 'Left.', date: '2024-06-01' },
          { title: 'Later', url: 'https://later.example/a', snippet: 'After the debate.', date: '2024-07-15' },
        ];
      if (query === 'claim one') return [{ title: 'Mixed', url: 'https://mixed.example/a', snippet: 'Left, mixed.' }];
      return { status: 503 };
    });
    let t = 0;
    const runs = await compareSearch(CASES, createTinyFishSearch(tinyfish.fetch, 'k'), { ratings: RATINGS, now: () => (t += 100) });
    const s = summarize('tinyfish', runs);

    // Claim 1: 4 returned, 1 dated after the claim; pool bls (full), vox (full), mixed (reduced), apnews from balancing (full).
    expect(runs[0]).toMatchObject({ returned: 4, afterDate: 1, balanced: true, classified: { full: 3, reduced: 1, context: 0, dropped: 0 } });
    expect(runs[0]!.evidence.map((e) => e.domain)).toEqual(['bls.gov', 'apnews.com', 'vox.com', 'mixed.example']);
    // bls.gov and apnews.com are in the frozen top 5 by domain; only bls.gov's link matches.
    expect(runs[0]!.overlap).toEqual({ domains: 2, urls: 1, frozen: 2 });
    // Claim 2: both queries fail twice (one retry each); nothing found.
    expect(runs[1]).toMatchObject({ returned: 0, balanced: false, evidence: [] });
    expect(s).toMatchObject({
      claims: 2,
      requests: 5,
      failedRequests: 2,
      failures: { "TinyFish's search did not answer": 2 },
      emptyQueries: 0,
      usable: 4,
      usableFull: 3,
      pool: 4,
      claimsWithFive: 0,
      claimsWithNone: 1,
      spread: { L: 2, LC: 0, C: 1, RC: 0, R: 0, Primary: 1, 'pro-science': 0, unrated: 0 },
      balancedClaims: 1,
      overlapDomains: 1,
      overlapUrls: 0.5,
    });
  });

  it('reads TinyFish’s "Mon D, YYYY" and "N units ago" dates before dropping results dated after the claim', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onSearch((query) =>
      query === 'fact one'
        ? [
            { title: 'Before', url: 'https://www.bls.gov/before', snippet: 'Before the debate.', date: 'Jun 1, 2024' },
            { title: 'After', url: 'https://www.bls.gov/after', snippet: 'After the debate.', date: 'Jul 15, 2024' },
            { title: 'Recent', url: 'https://www.bls.gov/recent', snippet: 'Days before the run.', date: '2 days ago' },
            { title: 'Old', url: 'https://www.bls.gov/old', snippet: 'Years before the run.', date: '3 years ago' },
          ]
        : [],
    );
    const runs = await compareSearch(CASES.slice(0, 1), createTinyFishSearch(tinyfish.fetch, 'k'), { ratings: RATINGS, searchedAt: new Date('2026-10-26T12:00:00Z') });
    // 3 years ago is 2022-10-26 to 2023-10-26: before the debate (2024-06-27).
    expect(runs[0]).toMatchObject({ returned: 4, afterDate: 2 });
    expect(runs[0]!.evidence.map((e) => e.url)).toEqual(['https://www.bls.gov/before', 'https://www.bls.gov/old']);
  });

  it('counts a refused search (TinyFish’s rate limit) as a failed request, with its reason', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onSearch((q) => (q === 'fact one' ? { status: 429 } : [{ title: 'BLS', url: 'https://bls.gov/x', snippet: 'x' }]));
    const runs = await compareSearch(CASES.slice(0, 1), createTinyFishSearch(tinyfish.fetch, 'key'), { ratings: RATINGS });
    const s = summarize('tinyfish', runs);
    expect(s.failures).toEqual({ "TinyFish's limit of searches a minute was reached": 1 });
    expect(runs[0]!.evidence.map((e) => e.domain)).toEqual(['bls.gov']);
  });
});
