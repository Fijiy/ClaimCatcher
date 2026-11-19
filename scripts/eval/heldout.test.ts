// The held-out accuracy set's harness (`pnpm eval:heldout-evidence`,
// `pnpm eval:heldout`): rating mapping, the leak filter, evidence freezing
// through the shipped TinyFish adapter and selection (over a fake TinyFish),
// and the cases the verdict step gets. Expected values are worked out by
// hand from the scripted results.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTinyFishSearch } from '../../src/session/checks/tinyfish';
import { createFakeTinyFish } from '../../src/session/testing/fake-search';
import { fakeRatings } from '../../src/session/testing/fake-ratings';
import { absoluteDate, freezeEvidence, heldoutCases, leakReason, mapRating, queriesFor, type HeldoutClaim } from './heldout';

const RATINGS = fakeRatings({
  'apnews.com': ['center', 'HIGH'],
  'vox.com': ['left', 'HIGH'],
  'wsj.com': ['right-center', 'HIGH'],
});

const claim = (over: Partial<HeldoutClaim> = {}): HeldoutClaim => ({
  id: 'pf/jane-doe/some-claim',
  claim: 'Jane Doe “cut taxes 12 times.”',
  speaker: 'Jane Doe',
  said: '2026-03-10',
  venue: 'a debate',
  factCheck: { publisher: 'PolitiFact', url: 'https://politifact.com/factchecks/2026/mar/12/jane-doe/x/', published: '2026-03-12', authors: ['A'], rating: 'Half True' },
  label: 'Misleading',
  basis: 'firm',
  ...over,
});

const result = (url: string, over: { title?: string; snippet?: string; published?: string | null } = {}) => ({
  title: over.title ?? 'A page',
  url,
  domain: new URL(url).hostname.replace(/^www\./, ''),
  snippet: over.snippet ?? 'Some text.',
  published: over.published ?? null,
});

describe('mapping a PolitiFact rating to a label (eval/README.md)', () => {
  it('maps the firm ratings by the table', () => {
    expect(mapRating('True')).toEqual({ label: 'True', basis: 'firm' });
    expect(mapRating('Mostly True')).toEqual({ label: 'True', basis: 'firm' });
    expect(mapRating('Half True')).toEqual({ label: 'Misleading', basis: 'firm' });
    expect(mapRating('False')).toEqual({ label: 'False', basis: 'firm' });
    expect(mapRating('Pants on Fire')).toEqual({ label: 'False', basis: 'firm' });
  });

  it('maps Mostly False by judgment, which must be given', () => {
    expect(mapRating('Mostly False', 'Misleading')).toEqual({ label: 'Misleading', basis: 'judgment' });
    expect(mapRating('Mostly False', 'False')).toEqual({ label: 'False', basis: 'judgment' });
    expect(() => mapRating('Mostly False')).toThrow(/judgment/);
  });

  it('agrees with every claim in eval/heldout/claims.json', () => {
    const claims = JSON.parse(readFileSync(new URL('../../eval/heldout/claims.json', import.meta.url), 'utf8')) as HeldoutClaim[];
    expect(claims.length).toBeGreaterThanOrEqual(100);
    for (const c of claims) {
      const judgment = c.basis === 'judgment' ? (c.label as 'Misleading' | 'False') : undefined;
      expect(mapRating(c.factCheck.rating, judgment), c.id).toEqual({ label: c.label, basis: c.basis });
      if (c.basis === 'judgment') expect(c.mappingNote, c.id).toBeTruthy();
      expect(c.said <= c.factCheck.published, c.id).toBe(true);
    }
    expect(new Set(claims.map((c) => c.id)).size).toBe(claims.length);
  });
});

describe('the searches for a claim', () => {
  it('is the claim’s words without quote marks, and the same plus the speaker', () => {
    expect(queriesFor(claim())).toEqual({ fact: 'Jane Doe cut taxes 12 times.', claim: 'Jane Doe cut taxes 12 times. Jane Doe' });
    expect(queriesFor(claim({ claim: '“We’re leading China by a lot.”', speaker: 'Donald Trump' }))).toEqual({
      fact: 'We’re leading China by a lot.',
      claim: 'We’re leading China by a lot. Donald Trump',
    });
  });
});

describe('the leak filter', () => {
  const said = '2026-03-10';
  it('drops the product’s professional fact-checkers', () => {
    expect(leakReason(result('https://www.politifact.com/factchecks/2026/mar/12/x/'), said)).toBe('fact-checker');
    expect(leakReason(result('https://apnews.com/article/fact-check-debate-trump-123'), said)).toBe('fact-checker');
    expect(leakReason(result('https://www.washingtonpost.com/politics/2026/01/02/fact-checker/'), said)).toBe('fact-checker');
  });

  it('drops pages that call themselves fact-checks, or quote a fact-checker’s rating', () => {
    expect(leakReason(result('https://news.example/a', { title: 'Fact check: Doe’s tax claim' }), said)).toBe('fact-check-words');
    expect(leakReason(result('https://news.example/b', { snippet: 'PolitiFact rated it Half True.' }), said)).toBe('fact-check-words');
    expect(leakReason(result('https://news.example/fact-check-doe-taxes'), said)).toBe('fact-check-words');
  });

  it('drops results dated after the day said, keeping that day', () => {
    expect(leakReason(result('https://news.example/c', { published: '2026-03-11T08:00:00Z' }), said)).toBe('after-said');
    expect(leakReason(result('https://news.example/d', { published: '2026-03-10' }), said)).toBeNull();
    expect(leakReason(result('https://news.example/e', { published: '2025-12-01' }), said)).toBeNull();
  });

  it('reads TinyFish’s other date forms: "Mon D, YYYY" and "N units ago" (from the day searched)', () => {
    const searched = new Date('2026-10-26T12:00:00Z');
    expect(leakReason(result('https://news.example/f', { published: 'Mar 11, 2026' }), said, searched)).toBe('after-said');
    expect(leakReason(result('https://news.example/g', { published: 'Jun 10, 2025' }), said, searched)).toBeNull();
    // 7 months ago: between 2026-02-26 and 2026-03-26, which straddles the day said.
    expect(leakReason(result('https://news.example/h', { published: '7 months ago' }), said, searched)).toBe('maybe-after-said');
    expect(leakReason(result('https://news.example/i', { published: '2 weeks ago' }), said, searched)).toBe('after-said');
    // 1 year ago: between 2024-10-26 and 2025-10-26.
    expect(leakReason(result('https://news.example/j', { published: '1 year ago' }), said, searched)).toBeNull();
    expect(leakReason(result('https://news.example/k', { published: '9 months ago' }), said, searched)).toBeNull();
    expect(leakReason(result('https://news.example/l', { published: '3 hours ago' }), said, searched)).toBe('after-said');
  });

  it('turns a relative date into the latest day it can be, for the verdict step', () => {
    const searched = new Date('2026-10-26T12:00:00Z');
    expect(absoluteDate('9 months ago', searched)).toBe('2026-01-26');
    expect(absoluteDate('Jun 10, 2025', searched)).toBe('2025-06-10');
    expect(absoluteDate('2026-01-05T10:00:00Z', searched)).toBe('2026-01-05');
    expect(absoluteDate('sometime', searched)).toBeNull();
  });

  it('drops a result with no date it or its link gives: it can’t be shown to predate the claim', () => {
    expect(leakReason(result('https://news.example/item/20261299'), said)).toBe('undated');
    expect(leakReason(result('https://en.wikipedia.org/wiki/Jane_Doe'), said)).toBe('undated');
    expect(leakReason(result('https://news.example/m', { published: 'sometime' }), said)).toBe('undated');
  });

  it('dates an undated result by its link when the link has a date', () => {
    expect(leakReason(result('https://news.example/2026/03/11/story'), said)).toBe('after-said-link-date');
    expect(leakReason(result('https://news.example/2026/mar/11/story'), said)).toBe('after-said-link-date');
    expect(leakReason(result('https://news.example/story-2026-04-02.html'), said)).toBe('after-said-link-date');
    expect(leakReason(result('https://news.example/2026/04/story'), said)).toBe('after-said-link-date');
    expect(leakReason(result('https://news.example/2026/03/story'), said)).toBeNull();
    expect(leakReason(result('https://news.example/2026/03/10/story'), said)).toBeNull();
    expect(leakReason(result('https://news.example/2025/11/30/story'), said)).toBeNull();
  });
});

describe('freezing a claim’s evidence', () => {
  it('runs both searches and the balancing search through the shipped adapter, drops leaks, and keeps what the verdict step sees', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onSearch((query, params) => {
      if (params.has('include_domains')) return [{ title: 'WSJ', url: 'https://wsj.com/b', snippet: 'Right-center take.', date: '2026-01-05' }];
      if (query === 'Jane Doe cut taxes 12 times.')
        return [
          { title: 'Vox', url: 'https://vox.com/a', snippet: 'Left take.', date: '2026-02-01' },
          { title: 'PolitiFact', url: 'https://www.politifact.com/factchecks/2026/mar/12/jane-doe/x/', snippet: 'Half True.' },
          { title: 'Later', url: 'https://vox.com/later', snippet: 'After.', date: '2026-03-20' },
        ];
      return [
        { title: 'Fact check: Doe', url: 'https://news.example/z', snippet: 'Ruling.' },
        { title: 'BLS', url: 'https://www.bls.gov/a', snippet: 'Primary data.', date: 'Feb 6, 2026' },
        { title: 'Undated', url: 'https://apnews.com/u', snippet: 'No date.' },
      ];
    });
    let t = 0;
    const pack = await freezeEvidence(claim(), createTinyFishSearch(tinyfish.fetch, 'k'), RATINGS, { now: () => (t += 100) });

    expect(pack.queries).toEqual(queriesFor(claim()));
    expect(pack.requests.map((r) => [r.query, r.results, r.error ?? null])).toEqual([
      ['fact', 3, null],
      ['claim', 3, null],
      // vox (left) and bls (primary): one-sided, so the balancing search runs.
      ['balance', 1, null],
    ]);
    expect(pack.dropped).toEqual({ 'fact-checker': 1, 'fact-check-words': 1, 'after-said': 1, 'maybe-after-said': 0, 'after-said-link-date': 0, undated: 1 });
    expect(pack.returned).toBe(7);
    expect(pack.results.filter((r) => r.dropped).every((r) => r.snippet === undefined)).toBe(true);
    expect(pack.results.find((r) => r.url === 'https://vox.com/a')).toMatchObject({ query: 'fact', rank: 1, snippet: 'Left take.' });
    expect(pack.balanced).toBe(true);
    expect(pack.evidence.map((e) => e.domain)).toEqual(['vox.com', 'bls.gov', 'wsj.com']);
    expect(pack.evidence.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it('records a failed search (after its one retry) and goes on with what it has', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onSearch((query) => (query.endsWith('Jane Doe') ? { status: 503 } : [{ title: 'BLS', url: 'https://bls.gov/x', snippet: 'x', date: '9 months ago' }]));
    const pack = await freezeEvidence(claim(), createTinyFishSearch(tinyfish.fetch, 'k'), RATINGS, { searchedAt: new Date('2026-10-26T12:00:00Z') });
    expect(pack.requests.map((r) => [r.query, r.error ?? null])).toEqual([
      ['fact', null],
      ['claim', "TinyFish's search did not answer"],
    ]);
    expect(pack.failed).toBe(true);
    expect(pack.evidence.map((e) => e.domain)).toEqual(['bls.gov']);
    // The relative date as the latest day it can be, so it reads right as of the day said; the result keeps TinyFish's words.
    expect(pack.evidence[0]!.published).toBe('2026-01-26');
    expect(pack.results[0]).toMatchObject({ published: '2026-01-26', publishedAsGiven: '9 months ago' });
  });
});

describe('re-filtering a frozen claim under stricter rules', () => {
  it('replays the stored searches, keeps their earlier drops, applies the rules again and searches only for balance', async () => {
    const searched = new Date('2026-10-26T12:00:00Z');
    const earlier = await freezeEvidence(
      claim(),
      {
        async search(query) {
          if (query.endsWith('Jane Doe')) return [result('https://news.example/p', { snippet: 'PolitiFact says Half True.', published: '2026-01-02' }), result('https://www.bls.gov/u', { title: 'BLS' })];
          return [result('https://vox.com/a', { title: 'Vox', published: '9 months ago' })];
        },
      },
      RATINGS,
      { searchedAt: searched },
    );
    // Pretend the BLS page was kept by an earlier, looser filter.
    const bls = earlier.results.find((r) => r.url === 'https://www.bls.gov/u')!;
    delete bls.dropped;
    bls.snippet = 'Primary data.';
    const asked: string[] = [];
    const tinyfish = createFakeTinyFish();
    tinyfish.onSearch((query, params) => {
      asked.push(params.has('include_domains') ? 'balance' : query);
      return [{ title: 'WSJ', url: 'https://wsj.com/b', snippet: 'Right-center take.', date: '2026-01-05' }];
    });
    const again = await freezeEvidence(claim(), createTinyFishSearch(tinyfish.fetch, 'k'), RATINGS, { earlier });
    // Only the balancing search went out: vox alone (left) is one-sided.
    expect(asked).toEqual(['balance']);
    expect(again.searchedAt).toBe(earlier.searchedAt);
    expect(again.requests.slice(0, 2)).toEqual(earlier.requests.slice(0, 2));
    expect(again.dropped).toMatchObject({ 'fact-check-words': 1, undated: 1 });
    expect(again.results.find((r) => r.url === 'https://vox.com/a')).toMatchObject({ published: '2026-01-26', publishedAsGiven: '9 months ago' });
    expect(again.evidence.map((e) => e.domain)).toEqual(['vox.com', 'wsj.com']);
  });
});

describe('the held-out cases', () => {
  it('give the verdict step the claim, its speaker, the date said and the frozen evidence', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onSearch(() => [{ title: 'BLS', url: 'https://bls.gov/x', snippet: 'x', date: '2026-01-02' }]);
    const pack = await freezeEvidence(claim(), createTinyFishSearch(tinyfish.fetch, 'k'), RATINGS);
    const [c] = heldoutCases([claim({ basis: 'judgment', label: 'False', factCheck: { ...claim().factCheck, rating: 'Mostly False' }, mappingNote: 'n' })], new Map([[pack.id, pack]]));
    expect(c).toMatchObject({
      id: 'pf/jane-doe/some-claim',
      date: '2026-03-10',
      truth: 'False',
      accept: ['False'],
      basis: 'judgment',
      input: { literal: 'Jane Doe “cut taxes 12 times.”', implied: '', context: '', title: 'Jane Doe in a debate', speaker: 'Jane Doe', judgedAsOf: '2026-03-10', saidOn: '2026-03-10' },
    });
    expect(c!.input.evidence).toEqual(pack.evidence);
  });

  it('refuses a claim with no frozen evidence', () => {
    expect(() => heldoutCases([claim()], new Map())).toThrow(/no frozen evidence/);
  });
});
