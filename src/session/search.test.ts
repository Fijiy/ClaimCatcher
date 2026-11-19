// Session tests for local mode's searches (ticket #45): TinyFish's search API
// behind the same search seam as the provider's (Venice). Gemini Nano is the fake `LanguageModel`; the network is fake
// `fetch`es (testing/fake-search.ts, testing/fake-venice.ts) joined into one
// that records every request, whatever its destination. Tests assert on what
// the viewer sees (cards, stop reasons) and on what left the device.

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeLanguageModel, type FakeLanguageModel } from './testing/fake-language-model';
import { createFakeTinyFish, network } from './testing/fake-search';
import { fakeRatings } from './testing/fake-ratings';
import { createFakeVenice } from './testing/fake-venice';
import type { Card, SearchId, SessionSettings, StopReason, Verdict } from './types';

const TAB = 4;
const PAGE = { title: 'Senator Example on the economy', url: 'https://video.example/watch?v=abc123', channel: 'Example News' };
const NOON = Date.UTC(2026, 9, 26, 12, 0, 0);
const TINYFISH_KEY = 'tinyfish-test-key-7c2e';
const VENICE_KEY = 'venice-test-key-3f9a';
const FACT = 'unemployment rate October 2024';
const CLAIM = 'unemployment fell to 4.1% Example';

const RATINGS = fakeRatings({
  'apnews.com': ['center', 'HIGH'],
  'wsj.com': ['right-center', 'HIGH'],
  'reuters.com': ['center', 'VERY HIGH'],
  'nationalreview.com': ['right', 'HIGH'],
  'nytimes.com': ['left-center', 'HIGH'],
  'vox.com': ['left', 'HIGH'],
  'cnbc.com': ['left-center', 'HIGH'],
});

function setup(search: SearchId, settings: Partial<SessionSettings> = {}) {
  const venice = createFakeVenice();
  const tinyfish = createFakeTinyFish();
  const net = network({
    'https://api.venice.ai': venice,
    'https://api.search.tinyfish.ai': tinyfish,
  });
  const nano = createFakeLanguageModel();
  nano.onBreakdown((user) => ({
    claims: [{ literal: /"([^"]*)"\s*$/.exec(user)![1]!, implied: 'The economy is strong.', premise_of: null, queries: { fact: FACT, claim: CLAIM } }],
    skipped: [],
  }));
  nano.onVerdict((user) => ({
    literal: '',
    implied: '',
    evidence: '',
    conclusion: 'The official figures match what was said.',
    label: 'True',
    missing: null,
    sources: [...user.matchAll(/^\[(\d+)\]/gm)].map((m) => ({ source: Number(m[1]), stance: 'supports' })),
  }));
  const session = createSession({
    clock: createFakeClock(NOON),
    fetch: net.fetch,
    languageModel: nano.factory,
    ratings: RATINGS,
    newId: () => 'session-1',
  });
  const stops: StopReason[] = [];
  session.subscribe((e) => {
    if (e.type === 'stopped') stops.push(e.reason);
  });
  const start = () =>
    session.dispatch({
      type: 'start',
      tabId: TAB,
      page: PAGE,
      settings: { mode: 'local', search, key: search === 'tinyfish' ? TINYFISH_KEY : '', ...settings },
    });
  let at = 0;
  const say = (text: string) => {
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: at, end: at + 4, text } });
    at += 4;
  };
  const cards = () => session.snapshot().cards;
  return { venice, tinyfish, net, nano, session, stops, start, say, cards };
}

async function settle() {
  for (let i = 0; i < 80; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const verdictOf = (card: Card | undefined): Verdict | undefined => (card?.check.state === 'done' ? card.check.verdict : undefined);
const hosts = (requests: Array<{ url: string }>) => requests.map((r) => new URL(r.url).host);

describe('local mode with TinyFish search', () => {
  it('needs no Venice key: the claims go to TinyFish with the TinyFish key, and their results become the card’s sources', async () => {
    const { tinyfish, net, start, say, cards } = setup('tinyfish');
    tinyfish.onSearch((query) =>
      query === FACT
        ? [
            { title: 'Unemployment rate steady at 4.1 percent in October 2024', url: 'https://www.bls.gov/opub/ted/2024/unemployment.htm', snippet: 'The <b>rate</b> was unchanged at 4.1 percent.' },
            { title: 'Jobs report', url: 'https://apnews.com/article/jobs-report', snippet: 'Employers added 12,000 jobs &amp; the rate held.', date: '2024-11-01' },
          ]
        : [],
    );
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    const verdict = verdictOf(cards()[0]);
    expect(verdict?.label).toBe('True');
    expect(verdict?.sources.map((s) => [s.domain, s.title, s.snippet, s.published])).toEqual([
      ['bls.gov', 'Unemployment rate steady at 4.1 percent in October 2024', 'The rate was unchanged at 4.1 percent.', null],
      ['apnews.com', 'Jobs report', 'Employers added 12,000 jobs & the rate held.', '2024-11-01'],
    ]);
    // Only the two searches left the device, both to TinyFish, with the key in its header and never in the URL.
    expect(hosts(net.requests)).toEqual(['api.search.tinyfish.ai', 'api.search.tinyfish.ai']);
    expect(tinyfish.requests.map((r) => new URL(r.url).searchParams.get('query')).sort()).toEqual([CLAIM, FACT].sort());
    for (const r of tinyfish.requests) {
      expect(r.method).toBe('GET');
      expect(r.headers['x-api-key']).toBe(TINYFISH_KEY);
      expect(r.url).not.toContain(TINYFISH_KEY);
    }
  });
});

describe('local mode with TinyFish search: failures', () => {
  it('a key TinyFish rejects stops listening with that reason, and the card says why; nothing goes anywhere else', async () => {
    const { tinyfish, net, start, say, cards, stops } = setup('tinyfish');
    tinyfish.onSearch(() => ({ status: 401 }));
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(stops).toEqual(['search-key-rejected']);
    expect(verdictOf(cards()[0])).toMatchObject({ label: 'Unverified', conclusion: "This couldn't be checked: the search rejected its API key." });
    // Not retried, and no other search was tried instead.
    expect(hosts(net.requests).every((h) => h === 'api.search.tinyfish.ai')).toBe(true);
    expect(net.requests.length).toBeLessThanOrEqual(2);
  });

  it('without a TinyFish key, listening stops at once and nothing is sent', () => {
    const { net, start, stops } = setup('tinyfish', { key: ' ' });
    start();
    expect(stops).toEqual(['no-search-key']);
    expect(net.requests).toEqual([]);
  });

  it('a search TinyFish limits (429) is tried once more, then the card ends Unverified saying so; listening goes on', async () => {
    const { tinyfish, start, say, cards, stops, session } = setup('tinyfish');
    tinyfish.onSearch(() => ({ status: 429 }));
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(verdictOf(cards()[0])).toMatchObject({
      label: 'Unverified',
      conclusion: "This couldn't be checked: TinyFish's limit of searches a minute was reached.",
    });
    expect(stops).toEqual([]);
    expect(session.snapshot().status.state).toBe('listening');
  });
});

describe('local mode with TinyFish search: balancing', () => {
  it('aims the balancing search with TinyFish’s domain filter, not with operators in the query', async () => {
    const { tinyfish, start, say, cards } = setup('tinyfish');
    tinyfish.onSearch((query, params) =>
      params.get('include_domains')
        ? [{ title: 'Jobs report', url: 'https://apnews.com/article/jobs', snippet: 'The rate held at 4.1%.' }]
        : query === FACT
          ? [{ title: 'Jobs', url: 'https://vox.com/jobs', snippet: 'Jobs news.' }]
          : [{ title: 'Jobs', url: 'https://nytimes.com/jobs', snippet: 'Jobs news.' }],
    );
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    const balancing = tinyfish.requests.map((r) => new URL(r.url).searchParams).find((p) => p.has('include_domains'));
    expect(balancing?.get('query')).toBe(FACT);
    expect(balancing?.get('include_domains')?.split(',')).toEqual(expect.arrayContaining(['apnews.com', 'reuters.com', 'wsj.com', 'nationalreview.com']));
    expect(balancing?.get('include_domains')).not.toContain('nytimes.com');
    expect(verdictOf(cards()[0])?.sources.map((s) => s.domain)).toEqual(expect.arrayContaining(['apnews.com']));
  });
});

describe('local mode: only search queries leave the device, and only to the chosen search', () => {
  it.each([
    ['tinyfish', 'api.search.tinyfish.ai'],
    ['venice', 'api.venice.ai'],
  ] as const)('with %s, every request goes to %s and carries only a query written from the claim', async (search, host) => {
    const { tinyfish, venice, net, start, say, cards } = setup(search, search === 'venice' ? { key: VENICE_KEY } : {});
    tinyfish.onSearch(() => [{ title: 'Jobs', url: 'https://bls.gov/jobs', snippet: 'The rate held.' }]);
    venice.onSearch(() => [{ title: 'Jobs', url: 'https://bls.gov/jobs', content: 'The rate held.' }]);
    start();

    say('Unemployment fell to 4.1% last month.');
    say('Wages rose 4% last year.');
    await settle();

    expect(cards().map((c) => verdictOf(c)?.label)).toEqual(['True', 'True']);
    expect(net.requests.length).toBeGreaterThan(0);
    expect(new Set(hosts(net.requests))).toEqual(new Set([host]));
    // Nothing of the page or the transcript beyond the queries: no title, channel, URL or sentence.
    for (const r of net.requests) {
      const sent = decodeURIComponent(r.url) + r.text;
      for (const secret of [PAGE.title, PAGE.channel, PAGE.url, 'Wages rose 4% last year.', 'Unemployment fell to 4.1% last month.']) {
        expect(sent).not.toContain(secret);
      }
    }
  });

  it('counts each search’s requests on its own counter', async () => {
    const { tinyfish, session, start, say } = setup('tinyfish');
    tinyfish.onSearch(() => [{ title: 'Jobs', url: 'https://bls.gov/jobs', snippet: 'The rate held.' }]);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(session.snapshot().counters).toMatchObject({ tinyfishSearches: 2, veniceSearches: 0, onDeviceCalls: 3, cloudCalls: 0 });
  });
});
