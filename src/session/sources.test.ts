// Session tests for source handling (spec "Sources"): how each search result
// is classified, weighted, shown on the card and given to the verdict step.
// The provider is a fake `fetch`, the MBFC snapshot a small fake table; tests
// assert on cards (what the viewer sees) and on the recorded verdict requests
// (what the verdict step was given).

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import type { MbfcBiasKey, MbfcReporting, RatingsSnapshot } from './sources/ratings';
import { createFakeClock } from './testing/fake-clock';
import { fakeRatings } from './testing/fake-ratings';
import { createFakeVenice } from './testing/fake-venice';
import type { CardSource, ContextSource, Verdict } from './types';

const TAB = 3;
const PAGE = { title: 'Floor debate on the budget', url: 'https://video.example/watch?v=x', channel: 'Example' };
const FACT = 'deficit figures';
const CLAIM = 'deficit doubled Example';

const RATINGS = fakeRatings({
  'veryhigh.example': ['center', 'VERY HIGH'],
  'high.example': ['left-center', 'HIGH'],
  'mixed.example': ['right', 'MIXED'],
  'mixed2.example': ['left', 'MIXED'],
});

function setup(ratings?: RatingsSnapshot) {
  const venice = createFakeVenice();
  const session = createSession({ clock: createFakeClock(Date.UTC(2026, 9, 26, 12)), fetch: venice.fetch, ratings, newId: () => 's' });
  session.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode: 'cloud', key: 'k' } });
  venice.onBreakdown(() => ({
    claims: [{ literal: 'The deficit doubled in 2025', implied: 'Spending is out of control', premise_of: null, queries: { fact: FACT, claim: CLAIM } }],
    skipped: [],
  }));
  let verdictAsked = '';
  venice.onVerdict(({ user }) => {
    verdictAsked = user;
    // Every numbered source supports, so stances can be checked per source.
    const numbers = [...user.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
    return {
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'The figures show a small rise, not a doubling.',
      label: 'False',
      missing: null,
      sources: numbers.map((n) => ({ source: n, stance: n === 1 ? 'contradicts' : 'supports' })),
    };
  });
  /** Scripts what the two searches find, as domains in rank order; any further (balancing) search finds `more`. */
  const found = (fact: string[], claim: string[] = [], more: string[] = []) =>
    venice.onSearch((query) => (query === FACT ? fact : query === CLAIM ? claim : more).map((d) => result(d)));
  /** The queries that went to search, in order. */
  const searched = () =>
    venice.requests.filter((r) => r.url.endsWith('/augment/search')).map((r) => (r.body as { query: string }).query);

  async function check(): Promise<{ verdict: Verdict; asked: string }> {
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: 0, end: 4, text: 'The deficit doubled in 2025.' } });
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    const check = session.snapshot().cards[0]?.check;
    if (check?.state !== 'done') throw new Error('the claim was not judged');
    return { verdict: check.verdict, asked: verdictAsked };
  }
  return { venice, session, found, searched, check };
}

function result(url: string) {
  const full = url.includes('/') ? url : `${url}/report`;
  return { title: `Title from ${url}`, url: `https://${full}`, content: `What ${url} says about the deficit.` };
}

const domains = (sources: Array<CardSource | ContextSource>) => sources.map((s) => s.domain);
/** The sources the verdict step was given, as `[n] domain`. */
const given = (asked: string) => [...asked.matchAll(/^\[(\d+)\] (\S+)/gm)].map((m) => `${m[1]} ${m[2]}`);

describe('sources: weight', () => {
  it('ranks full-weight sources above reduced ones when picking the top 5, still alternating between queries', async () => {
    const { found, check } = setup(RATINGS);
    found(['mixed.example', 'unrated.example', 'high.example'], ['mixed2.example', 'veryhigh.example']);

    const { verdict, asked } = await check();

    expect(domains(verdict.sources)).toEqual(['high.example', 'veryhigh.example', 'mixed.example', 'mixed2.example', 'unrated.example']);
    expect(verdict.sources.map((s) => s.weight)).toEqual(['full', 'full', 'reduced', 'reduced', 'reduced']);
    expect(given(asked)).toEqual(['1 high.example', '2 veryhigh.example', '3 mixed.example', '4 mixed2.example', '5 unrated.example']);
  });

  it("tells the verdict step each source's tier", async () => {
    const { found, check } = setup(RATINGS);
    found(['high.example', 'mixed.example', 'unrated.example']);

    const { asked } = await check();

    const line = (domain: string) => asked.split('\n').find((l) => l.includes(` ${domain}`)) ?? '';
    expect(line('high.example')).toMatch(/full weight/);
    expect(line('mixed.example')).toMatch(/mixed reliability.*counts less/);
    expect(line('unrated.example')).toMatch(/not rated.*counts less/);
  });
});

describe('sources: excluded', () => {
  it.each([
    ['MBFC LOW', 'low.example', ['right', 'LOW']],
    ['fake-news', 'fake.example', ['fake-news', 'FAKE']],
    ['conspiracy', 'conspiracy.example', ['conspiracy', 'MIXED']],
    ['satire', 'satire.example', ['satire', null]],
  ] as const)('%s sites are not evidence and are not shown', async (_row, domain, rating) => {
    const { found, check } = setup(fakeRatings({ 'high.example': ['center', 'HIGH'], [domain]: [...rating] }));
    found([domain, 'high.example'], [`news.${domain}`]);

    const { verdict, asked } = await check();

    expect(domains(verdict.sources)).toEqual(['high.example']);
    expect(verdict.context).toBeUndefined();
    expect(asked).not.toContain(domain);
  });

  it('keeps a spoof domain apart from the outlet it imitates', async () => {
    const { found, check } = setup(fakeRatings({ 'abcnews.go.com': ['left-center', 'HIGH'], 'abcnews.com.co': ['fake-news', 'FAKE'] }));
    found(['abcnews.com.co', 'abcnews.go.com']);

    const { verdict } = await check();

    expect(domains(verdict.sources)).toEqual(['abcnews.go.com']);
  });
});

describe('sources: user-generated', () => {
  it('never uses or shows a post on a social or video platform, subdomains included', async () => {
    const { found, check } = setup(RATINGS);
    found(['x.com/someone/status/1', 'm.facebook.com/post/2', 'high.example'], ['www.youtube.com/watch?v=3', 'old.reddit.com/r/x/4', 'tiktok.com/@a/5']);

    const { verdict, asked } = await check();

    expect(domains(verdict.sources)).toEqual(['high.example']);
    expect(verdict.context).toBeUndefined();
    for (const platform of ['x.com', 'facebook.com', 'youtube.com', 'reddit.com', 'tiktok.com']) expect(asked).not.toContain(platform);
  });
});

describe('sources: partisan', () => {
  it('shows campaign, party and political-office sites as context only, and never gives them to the verdict step', async () => {
    // MBFC rates whitehouse.gov and gop.com as outlets; the partisan list overrides that.
    const { found, check } = setup(fakeRatings({ 'whitehouse.gov': ['right', 'MIXED'], 'gop.com': ['right', 'MIXED'], 'high.example': ['center', 'HIGH'] }));
    found(['whitehouse.gov/briefing', 'high.example'], ['pelosi.house.gov/news', 'gop.com/deficit']);

    const { verdict, asked } = await check();

    expect(domains(verdict.sources)).toEqual(['high.example']);
    expect(given(asked)).toEqual(['1 high.example']);
    for (const site of ['whitehouse.gov', 'house.gov', 'gop.com']) expect(asked).not.toContain(site);
    expect(verdict.context?.map((s) => [s.domain, s.rating])).toEqual([
      ['whitehouse.gov', { kind: 'mbfc', bias: 'R', reliability: 'mixed', name: 'whitehouse.gov', page: 'https://mediabiasfactcheck.com/whitehouse-gov/' }],
      ['pelosi.house.gov', { kind: 'unrated' }],
      ['gop.com', { kind: 'mbfc', bias: 'R', reliability: 'mixed', name: 'gop.com', page: 'https://mediabiasfactcheck.com/gop-com/' }],
    ]);
  });

  it.each<[string, [MbfcBiasKey, MbfcReporting | null]]>([
    ['LOW', ['right', 'LOW']],
    ['fake-news', ['fake-news', 'VERY LOW']],
    ['conspiracy', ['conspiracy', 'MIXED']],
    ['satire', ['satire', null]],
  ])('never shows a partisan site MBFC rates %s, even as context', async (_case, rating) => {
    const { found, check } = setup(fakeRatings({ 'gop.com': rating, 'high.example': ['center', 'HIGH'] }));
    found(['gop.com/deficit', 'high.example']);

    const { verdict, asked } = await check();

    expect(domains(verdict.sources)).toEqual(['high.example']);
    expect(verdict.context ?? []).toEqual([]);
    expect(asked).not.toContain('gop.com');
  });
});

describe('sources: primary', () => {
  it('counts official data, courts, legislatures, journals and .edu in full, with a Primary pill, over any MBFC rating', async () => {
    const { found, check } = setup(fakeRatings({ 'house.gov': ['center', 'MIXED'], 'mixed.example': ['right', 'MIXED'] }));
    found(['mixed.example', 'data.bls.gov/timeseries', 'clerk.house.gov/votes'], ['supremecourt.gov/opinions', 'econ.stateu.edu/paper']);

    const { verdict, asked } = await check();

    expect(domains(verdict.sources)).toEqual(['data.bls.gov', 'supremecourt.gov', 'clerk.house.gov', 'econ.stateu.edu', 'mixed.example']);
    expect(verdict.sources.map((s) => [s.rating.kind, s.weight])).toEqual([
      ['primary', 'full'],
      ['primary', 'full'],
      ['primary', 'full'],
      ['primary', 'full'],
      ['mbfc', 'reduced'],
    ]);
    expect(asked.split('\n').find((l) => l.startsWith('[1]'))).toMatch(/primary source, full weight/);
  });

  it('counts a .edu site as Primary at full weight even when MBFC rates it', async () => {
    const { found, check } = setup(fakeRatings({ 'brookings.edu': ['left-center', 'MIXED'] }));
    found(['brookings.edu/research']);

    const { verdict } = await check();

    expect(verdict.sources[0]).toMatchObject({ domain: 'brookings.edu', weight: 'full', rating: { kind: 'primary' } });
  });
});

describe('sources: bias', () => {
  it('never changes a source\'s weight', async () => {
    const { found, check } = setup(
      fakeRatings({
        'l.example': ['left', 'HIGH'],
        'lc.example': ['left-center', 'MIXED'],
        'c.example': ['center', 'HIGH'],
        'rc.example': ['right-center', 'MIXED'],
        'r.example': ['right', 'HIGH'],
      }),
    );
    found(['l.example', 'lc.example', 'c.example'], ['r.example', 'rc.example']);

    const { verdict } = await check();

    expect(verdict.sources.map((s) => [s.domain, s.rating.kind === 'mbfc' ? s.rating.bias : null, s.weight])).toEqual([
      ['l.example', 'L', 'full'],
      ['r.example', 'R', 'full'],
      ['c.example', 'C', 'full'],
      ['lc.example', 'LC', 'reduced'],
      ['rc.example', 'RC', 'reduced'],
    ]);
  });
});

describe('sources: what each shown source carries', () => {
  it('has its pill (MBFC bias and page, or Primary), title, real domain, stance and reliability', async () => {
    const { found, check } = setup(fakeRatings({ 'npr.org': ['left-center', 'HIGH'], 'foxnews.com': ['right', 'MIXED'], 'outlet.example': ['center', null] }));
    found(['www.bls.gov/cps', 'npr.org/story'], ['foxnews.com/politics', 'outlet.example', 'blog.example']);

    const { verdict } = await check();

    expect(verdict.sources).toMatchObject([
      { n: 1, domain: 'bls.gov', title: 'Title from www.bls.gov/cps', url: 'https://www.bls.gov/cps', stance: 'contradicts', weight: 'full', rating: { kind: 'primary' } },
      {
        n: 2,
        domain: 'npr.org',
        stance: 'supports',
        weight: 'full',
        rating: { kind: 'mbfc', bias: 'LC', reliability: 'high', page: 'https://mediabiasfactcheck.com/npr-org/' },
      },
      { n: 3, domain: 'foxnews.com', weight: 'reduced', rating: { kind: 'mbfc', bias: 'R', reliability: 'mixed' } },
      { n: 4, domain: 'outlet.example', weight: 'reduced', rating: { kind: 'mbfc', bias: 'C', reliability: null } },
      { n: 5, domain: 'blog.example', weight: 'reduced', rating: { kind: 'unrated' } },
    ]);
  });

  it('finds the rating under a path, an alias or a parent domain', async () => {
    const { found, check } = setup(
      fakeRatings(
        { 'cato.org': ['right-center', 'HIGH'], 'cato.org/regulation': ['right-center', 'MIXED'], 'bbc.com': ['left-center', 'HIGH'], 'nytimes.com': ['left-center', 'HIGH'] },
        { 'bbc.co.uk': 'bbc.com' },
      ),
    );
    found(['cato.org/regulation/spring-2026/deficit', 'www.bbc.co.uk/news/1'], ['cooking.nytimes.com/x', 'cato.org/blog/deficit']);

    const { verdict } = await check();

    expect(verdict.sources.map((s) => [s.domain, s.weight])).toEqual([
      ['bbc.co.uk', 'full'],
      ['cooking.nytimes.com', 'full'],
      ['cato.org', 'full'],
      ['cato.org', 'reduced'],
    ]);
  });
});

describe('sources: the bundled MBFC snapshot', () => {
  it('rates sources from the snapshot taken at build time when no other ratings are given', async () => {
    const { found, check } = setup();
    found(['foxnews.com/politics/deficit', 'apnews.com/article/deficit'], ['whitehouse.gov/briefing', 'cbo.gov/publication/1']);

    const { verdict, asked } = await check();

    expect(verdict.sources).toMatchObject([
      { domain: 'apnews.com', weight: 'full', rating: { kind: 'mbfc', bias: 'C', reliability: 'very high', page: 'https://mediabiasfactcheck.com/associated-press/' } },
      { domain: 'cbo.gov', weight: 'full', rating: { kind: 'primary' } },
      { domain: 'foxnews.com', weight: 'reduced', rating: { kind: 'mbfc', bias: 'R', reliability: 'mixed', page: 'https://mediabiasfactcheck.com/fox-news/' } },
    ]);
    expect(verdict.context?.map((s) => s.domain)).toEqual(['whitehouse.gov']);
    expect(asked).not.toContain('whitehouse.gov');
  });
});

describe('sources: balancing search', () => {
  // Outlets a balancing search can aim at, plus some to find.
  const SPECTRUM = fakeRatings({
    'apnews.com': ['center', 'VERY HIGH'],
    'reuters.com': ['center', 'VERY HIGH'],
    'wsj.com': ['right-center', 'HIGH'],
    'nationalreview.com': ['right', 'HIGH'],
    'nytimes.com': ['left-center', 'HIGH'],
    'vox.com': ['left', 'HIGH'],
    'l.example': ['left', 'HIGH'],
    'lc.example': ['left-center', 'MIXED'],
    'c.example': ['center', 'HIGH'],
    'r.example': ['right', 'HIGH'],
    'rc.example': ['right-center', 'HIGH'],
  });
  const domainsIn = (query: string) => query.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|example)\b/g) ?? [];

  it('searches once more, aimed at the other side and Center, when every rated source is on the left', async () => {
    const { found, searched, check } = setup(SPECTRUM);
    found(['l.example', 'data.bls.gov/x'], ['lc.example', 'unrated.example'], ['c.example', 'rc.example']);

    const { verdict, asked } = await check();

    const queries = searched();
    expect(queries).toHaveLength(3);
    const aimedAt = domainsIn(queries[2]!);
    expect(aimedAt).toEqual(expect.arrayContaining(['apnews.com', 'wsj.com', 'nationalreview.com']));
    expect(aimedAt).not.toContain('nytimes.com');
    expect(aimedAt).not.toContain('vox.com');
    // Its results join the pool before the top 5 are chosen.
    expect(domains(verdict.sources)).toEqual(['l.example', 'c.example', 'data.bls.gov', 'rc.example', 'lc.example']);
    expect(given(asked).map((g) => g.split(' ')[1])).toEqual(domains(verdict.sources));
  });

  it('aims at the left and Center when every rated source is on the right', async () => {
    const { found, searched, check } = setup(SPECTRUM);
    found(['r.example'], ['rc.example'], ['l.example']);

    const { verdict } = await check();

    const aimedAt = domainsIn(searched()[2] ?? '');
    expect(aimedAt).toEqual(expect.arrayContaining(['apnews.com', 'nytimes.com', 'vox.com']));
    expect(aimedAt).not.toContain('wsj.com');
    expect(aimedAt).not.toContain('nationalreview.com');
    expect(domains(verdict.sources)).toEqual(['r.example', 'rc.example', 'l.example']);
  });

  it.each([
    ['sources on both sides', ['l.example', 'r.example']],
    ['a Center source among left ones', ['l.example', 'lc.example', 'c.example']],
    ['only Center sources', ['c.example']],
    ['no rated source (primary and unrated only)', ['data.bls.gov/x', 'unrated.example']],
    ['no sources at all', []],
  ])('runs no further search with %s', async (_case, fact) => {
    const { found, searched, check } = setup(SPECTRUM);
    found(fact, [], ['rc.example']);

    const { verdict } = await check();

    expect(searched()).toEqual([FACT, CLAIM]);
    expect(domains(verdict.sources)).not.toContain('rc.example');
  });

  it("never drops an outlet or lowers its weight for its bias rating", async () => {
    const { found, check } = setup(SPECTRUM);
    found(['l.example', 'lc.example'], [], ['c.example', 'r.example']);

    const { verdict } = await check();

    expect(verdict.sources.map((s) => [s.domain, s.weight])).toEqual([
      ['l.example', 'full'],
      ['c.example', 'full'],
      ['r.example', 'full'],
      ['lc.example', 'reduced'],
    ]);
  });

  it('weighs what was found when the balancing search fails twice', async () => {
    const { venice, found, searched, check } = setup(SPECTRUM);
    found(['l.example'], ['lc.example']);
    venice.onSearch((query) =>
      query === FACT ? [result('l.example')] : query === CLAIM ? [result('lc.example')] : { status: 503, error: 'busy' },
    );

    const { verdict } = await check();

    expect(searched()).toHaveLength(4); // fact, claim, balancing and its one retry
    expect(verdict.label).toBe('False');
    expect(domains(verdict.sources)).toEqual(['l.example', 'lc.example']);
  });

  it('aims at real Center and right-of-center outlets with the bundled ratings', async () => {
    const { found, searched, check } = setup();
    found(['nytimes.com/2026/deficit', 'vox.com/deficit'], ['msnbc.com/deficit']);

    await check();

    const aimedAt = domainsIn(searched()[2] ?? '');
    expect(aimedAt).toEqual(expect.arrayContaining(['apnews.com', 'reuters.com', 'wsj.com']));
    expect(aimedAt).not.toContain('nytimes.com');
  });
});

describe('sources: links', () => {
  /** One search result with this exact link. */
  const at = (url: string, title = 'A report') => ({ title, url, content: 'What the report says about the deficit.' });

  it.each([
    ['strips utm_* parameters', 'https://www.npr.org/2026/10/deficit?utm_source=twitter&utm_medium=social&UTM_Campaign=x', 'https://www.npr.org/2026/10/deficit', 'npr.org'],
    [
      'strips other common tracking parameters and keeps the rest',
      'https://example.org/story?id=42&fbclid=abc&gclid=def&mc_cid=1&mc_eid=2&_ga=3&igshid=4&msclkid=5&page=2#section',
      'https://example.org/story?id=42&page=2#section',
      'example.org',
    ],
    ['unwraps a Google redirect', 'https://www.google.com/url?sa=t&url=https%3A%2F%2Fwww.cbo.gov%2Fpublication%2F1%3Futm_source%3Dg&usg=x', 'https://www.cbo.gov/publication/1', 'cbo.gov'],
    ['unwraps a Facebook outbound link', 'https://l.facebook.com/l.php?u=https%3A%2F%2Fapnews.com%2Farticle%2Fdeficit&h=AT0', 'https://apnews.com/article/deficit', 'apnews.com'],
    ['unwraps a DuckDuckGo link', 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fworld%2Fdeficit%2F&rut=1', 'https://www.reuters.com/world/deficit/', 'reuters.com'],
    ['unwraps an Outlook safe link', 'https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.bls.gov%2Fcps%2F&data=05', 'https://www.bls.gov/cps/', 'bls.gov'],
    ['unwraps a generic redirect endpoint', 'https://news.example/redirect?to=https%3A%2F%2Fwww.census.gov%2Fdata', 'https://www.census.gov/data', 'census.gov'],
    ['unwraps a Google AMP link', 'https://www.google.com/amp/s/www.nbcnews.com/politics/deficit-rcna1', 'https://www.nbcnews.com/politics/deficit-rcna1', 'nbcnews.com'],
    ['unwraps an AMP cache link', 'https://www-cbsnews-com.cdn.ampproject.org/c/s/www.cbsnews.com/amp/news/deficit/', 'https://www.cbsnews.com/amp/news/deficit/', 'cbsnews.com'],
    ['unwraps a Bing click link', 'https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly93d3cuY2JvLmdvdi90b3BpY3MvYnVkZ2V0P3V0bV9zb3VyY2U9YmluZw&ntb=1', 'https://www.cbo.gov/topics/budget', 'cbo.gov'],
    ['unwraps wrappers inside wrappers', 'https://www.google.com/url?q=https%3A%2F%2Fl.facebook.com%2Fl.php%3Fu%3Dhttps%253A%252F%252Fwww.pbs.org%252Fnewshour%253Futm_medium%253Dx', 'https://www.pbs.org/newshour', 'pbs.org'],
    ['leaves a link alone that only names a URL in a page parameter', 'https://example.org/login?redirect=https%3A%2F%2Fexample.org%2Fstory', 'https://example.org/login?redirect=https%3A%2F%2Fexample.org%2Fstory', 'example.org'],
    ['leaves a shortened link alone: the final URL is not in it', 'https://bit.ly/3xYz', 'https://bit.ly/3xYz', 'bit.ly'],
  ])('%s', async (_case, link, clean, domain) => {
    const { venice, check } = setup(RATINGS);
    venice.onSearch((query) => (query === FACT ? [at(link)] : []));

    const { verdict, asked } = await check();

    expect(verdict.sources.map((s) => [s.url, s.domain])).toEqual([[clean, domain]]);
    expect(given(asked)).toEqual([`1 ${domain}`]);
  });

  it('classifies a link by its final domain', async () => {
    const { venice, check } = setup(fakeRatings({ 'high.example': ['center', 'HIGH'] }));
    venice.onSearch((query) => (query === FACT ? [at('https://www.google.com/url?q=https://high.example/report&sa=U'), at('https://www.google.com/url?q=https://x.com/a/status/1')] : []));

    const { verdict } = await check();

    expect(verdict.sources).toMatchObject([{ domain: 'high.example', weight: 'full', rating: { kind: 'mbfc', bias: 'C' } }]);
  });

  it('cleans context-only links too', async () => {
    const { venice, check } = setup(RATINGS);
    venice.onSearch((query) => (query === FACT ? [at('https://www.whitehouse.gov/briefing?utm_source=newsletter')] : []));

    const { verdict } = await check();

    expect(verdict.context?.map((s) => s.url)).toEqual(['https://www.whitehouse.gov/briefing']);
  });

  it('drops a result whose link is not a web page', async () => {
    const { venice, check } = setup(RATINGS);
    venice.onSearch((query) => (query === FACT ? [at('javascript:alert(1)'), at('https://high.example/r?url=javascript%3Aalert(1)')] : []));

    const { verdict } = await check();

    expect(verdict.sources.map((s) => s.url)).toEqual(['https://high.example/r?url=javascript%3Aalert(1)']);
  });

  it('never makes a request to follow a redirect: every request goes to the provider', async () => {
    const { venice, check } = setup(RATINGS);
    venice.onSearch((query) => (query === FACT ? [at('https://bit.ly/3xYz'), at('https://t.co/abc'), at('https://www.google.com/url?q=https://high.example/a')] : []));

    await check();

    expect(venice.requests.length).toBeGreaterThan(0);
    for (const request of venice.requests) expect(new URL(request.url).origin).toBe('https://api.venice.ai');
  });
});

describe('sources: professional fact-checks', () => {
  it('marks results from known fact-checkers with who checked it, and only those', async () => {
    const { found, check } = setup(fakeRatings({ 'politifact.com': ['center', 'VERY HIGH'], 'apnews.com': ['center', 'VERY HIGH'], 'reuters.com': ['center', 'VERY HIGH'] }));
    found(
      ['politifact.com/factchecks/2026/oct/20/someone/deficit-doubled/', 'apnews.com/article/deficit-budget-1', 'www.factcheck.org/2026/10/deficit/'],
      ['apnews.com/article/fact-check-deficit-doubled-2', 'www.reuters.com/fact-check/deficit-claim-2026-10-21/'],
    );

    const { verdict } = await check();

    expect(verdict.sources.map((s) => [s.domain, s.factCheck])).toEqual([
      ['politifact.com', 'PolitiFact'],
      ['apnews.com', 'AP Fact Check'],
      ['apnews.com', undefined],
      ['reuters.com', 'Reuters Fact Check'],
      ['factcheck.org', 'FactCheck.org'],
    ]);
  });

  it('recognises a fact-check behind a redirect wrapper', async () => {
    const { venice, check } = setup(RATINGS);
    venice.onSearch((query) =>
      query === FACT ? [{ title: 'Fact check', url: 'https://www.google.com/url?q=https://www.snopes.com/fact-check/deficit/', content: 'Rating: False.' }] : [],
    );

    const { verdict } = await check();

    expect(verdict.sources).toMatchObject([{ domain: 'snopes.com', factCheck: 'Snopes' }]);
  });

  it("keeps ClaimCatcher's own verdict, whatever the fact-check concluded", async () => {
    const { venice, found, check } = setup(fakeRatings({ 'politifact.com': ['center', 'VERY HIGH'] }));
    found(['politifact.com/factchecks/2026/oct/20/someone/deficit-doubled/', 'data.bls.gov/x']);
    venice.onVerdict(() => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'The deficit rose by about a third, not double.',
      label: 'Misleading',
      missing: 'The rise was a third, not double.',
      sources: [
        { source: 1, stance: 'contradicts' },
        { source: 2, stance: 'contradicts' },
      ],
    }));

    const { verdict } = await check();

    expect(verdict).toMatchObject({ label: 'Misleading', conclusion: 'The deficit rose by about a third, not double.' });
    expect(verdict.sources[0]).toMatchObject({ factCheck: 'PolitiFact', stance: 'contradicts', weight: 'full' });
  });
});

describe('sources: opened mark', () => {
  it('marks a source the viewer opened for the rest of the session, once, even after listening stops', async () => {
    const { session, found, check } = setup(RATINGS);
    found(['high.example', 'mixed.example'], ['whitehouse.gov/briefing']);
    const { verdict } = await check();
    const events: string[] = [];
    session.subscribe((event) => events.push(event.type));
    const [first, second] = verdict.sources.map((s) => s.url);
    const partisan = verdict.context![0]!.url;

    session.dispatch({ type: 'source-opened', url: second! });
    session.dispatch({ type: 'source-opened', url: second! });
    session.dispatch({ type: 'stop', reason: 'viewer' });
    session.dispatch({ type: 'source-opened', url: partisan });

    expect(session.snapshot().opened).toEqual([second, partisan]);
    expect(session.snapshot().opened).not.toContain(first);
    expect(events).toEqual(['source-opened', 'stopped', 'source-opened']);
  });

  it('ignores a link that no card shows', async () => {
    const { session, found, check } = setup(RATINGS);
    found(['high.example']);
    await check();

    session.dispatch({ type: 'source-opened', url: 'https://elsewhere.example/' });

    expect(session.snapshot().opened).toEqual([]);
  });

  it('starts a new session with nothing opened', () => {
    const session = createSession({ clock: createFakeClock(0), fetch: createFakeVenice().fetch, newId: () => 's2' });
    expect(session.snapshot().opened).toEqual([]);
  });
});
