// Session tests for cloud checks: each sentence is broken down into claims,
// searched, and judged by the provider. The provider is a fake `fetch`
// (testing/fake-venice.ts); tests assert only on what the viewer would see
// (events and snapshots) and on what left the device (recorded requests).

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeVenice, type FakeVenice } from './testing/fake-venice';
import type { Card, PageContext, SessionEvent } from './types';

const TAB = 7;
const KEY = 'venice-test-key-3f9a';
const PAGE = { title: 'Senator Example on the economy', url: 'https://video.example/watch?v=abc123', channel: 'Example News' };
const NOON = Date.UTC(2026, 9, 26, 12, 0, 0);

function setup(options: { apiKey?: string; page?: Partial<PageContext> } = {}) {
  const clock = createFakeClock(NOON);
  const venice = createFakeVenice();
  const session = createSession({ clock, fetch: venice.fetch, newId: () => 'session-1' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({ type: 'start', tabId: TAB, page: { ...PAGE, ...options.page }, settings: { mode: 'cloud', key: options.apiKey ?? KEY } });
  let cueAt = 0;
  const say = (text: string, at = cueAt) => {
    cueAt = at + 4;
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: at, end: at + 4, text } });
  };
  const cards = () => session.snapshot().cards;
  return { clock, venice, session, events, say, cards };
}

/** Lets every pending check run to completion. */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function claim(literal: string, extra: Partial<{ implied: string; premise_of: string | null; fact: string; claim: string }> = {}) {
  return {
    literal,
    implied: extra.implied ?? `${literal} (implied)`,
    premise_of: extra.premise_of ?? null,
    queries: { fact: extra.fact ?? `${literal} figures`, claim: extra.claim ?? `${literal} Example` },
  };
}

function result(domain: string, title: string, content = `${title}: what the record shows.`) {
  return { title, url: `https://${domain}/${title.toLowerCase().replace(/\W+/g, '-')}`, content };
}

/** Scripts a provider that finds two sources per query and calls every claim True. */
function happyProvider(venice: FakeVenice) {
  venice.onSearch((query) => [result('bls.gov', `BLS on ${query}`), result('apnews.com', `AP on ${query}`)]);
  venice.onVerdict(() => ({
    literal: 'The literal claim.',
    implied: 'The takeaway.',
    evidence: 'The sources give the same figure.',
    conclusion: 'The official figures match what was said.',
    label: 'True',
    missing: null,
    sources: [
      { source: 1, stance: 'supports' },
      { source: 2, stance: 'supports' },
    ],
  }));
}

const labels = (cards: Card[]) => cards.map((c) => (c.check.state === 'done' ? c.check.verdict.label : 'checking'));

describe('checks: claim breakdown', () => {
  it('gives a compound sentence one card per claim', async () => {
    const { venice, say, cards } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({
      claims: [claim('Unemployment fell to 4.1% last month'), claim('Inflation has fallen for six straight months')],
      skipped: [],
    }));

    say('Unemployment fell to four point one percent last month and inflation has fallen for six straight months.');
    await settle();

    expect(cards().map((c) => c.claim?.literal)).toEqual([
      'Unemployment fell to 4.1% last month',
      'Inflation has fallen for six straight months',
    ]);
    expect(labels(cards())).toEqual(['True', 'True']);
  });
});

describe('checks: skipped statements', () => {
  it('reports skipped parts on the line, and checks the premise inside a promise as its own claim', async () => {
    const { venice, say, cards, session } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({
      claims: [claim('Taxes are the highest in history', { premise_of: "I'll cut them" })],
      skipped: [{ text: "I'll cut them", reason: 'promise' }],
    }));

    say("Because taxes are the highest in history, I'll cut them.");
    await settle();

    expect(session.snapshot().lines[0]?.skipped).toEqual([{ text: "I'll cut them", reason: 'promise' }]);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.claim).toEqual({
      literal: 'Taxes are the highest in history',
      implied: 'Taxes are the highest in history (implied)',
      premiseOf: "I'll cut them",
      premiseKind: 'promise',
    });
  });

  it('names the kind of skipped statement a premise rests on, matching its words loosely', async () => {
    const { venice, say, cards } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({
      claims: [
        claim('Our state produces more wind power than any other', { premise_of: '“So we will lead the world in clean energy.”' }),
        claim('Wind farms employ 30,000 people here', { premise_of: 'and that is why we must act' }),
      ],
      skipped: [{ text: 'so we will lead the world in clean energy', reason: 'prediction' }],
    }));

    say('Our state produces more wind power than any other, so we will lead the world in clean energy.');
    await settle();

    expect(cards().map((c) => [c.claim?.premiseOf, c.claim?.premiseKind])).toEqual([
      // Quoted as the line says it.
      ['so we will lead the world in clean energy', 'prediction'],
      // Words the sentence never said: no premise.
      [null, undefined],
    ]);
  });

  it('leaves no card for a sentence with no checkable claim', async () => {
    const { venice, say, cards, session } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [], skipped: [{ text: 'This is the greatest country on earth.', reason: 'opinion' }] }));

    say('This is the greatest country on earth.');
    await settle();

    expect(cards()).toEqual([]);
    expect(session.snapshot().lines[0]?.skipped).toEqual([{ text: 'This is the greatest country on earth.', reason: 'opinion' }]);
  });

  it('checks each sentence of a cue on its own, and joins a sentence split across cues', async () => {
    const { venice, say, cards } = setup();
    happyProvider(venice);
    venice.onBreakdown(({ user }) => ({ claims: [claim(/"(.*)"\s*$/.exec(user)![1]!)], skipped: [] }));

    say('Wages rose 4% last year. Prices rose 3%.', 0);
    say('Our exports grew', 4);
    say('by a record amount.', 8);
    await settle();

    expect(cards().map((c) => [c.sentence, c.time])).toEqual([
      ['Wages rose 4% last year.', 0],
      ['Prices rose 3%.', 0],
      ['Our exports grew by a record amount.', 4],
    ]);
  });
  it('joins House roll-up fragments into sentences, keeping the reader\'s (already lag-shifted) times', async () => {
    const { venice, session, cards } = setup();
    happyProvider(venice);
    venice.onBreakdown(({ user }) => ({ claims: [claim(/"(.*)"\s*$/.exec(user)![1]!)], skipped: [] }));

    // As the House reader hands them on: one roll-up line each, already shifted 4 s earlier.
    const lines: Array<[number, string]> = [
      [1, 'MEET THE MOMENT. I URGE ALL MY'],
      [1.13, 'COLLEAGUES TO SUPPORT H. RES.'],
      [2.96, '1530 AND THE UNDERLYING'],
      [4.76, 'LEGISLATION, AND I YIELD BACK.'],
    ];
    for (const [start, text] of lines) {
      session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'house', start, end: start + 2, text } });
    }
    await settle();

    expect(cards().map((c) => [c.sentence, c.time])).toEqual([
      ['MEET THE MOMENT.', 1],
      ['I URGE ALL MY COLLEAGUES TO SUPPORT H. RES. 1530 AND THE UNDERLYING LEGISLATION, AND I YIELD BACK.', 1],
    ]);
  });
});

describe('checks: evidence', () => {
  it('weighs the top 5 results at 400 characters each, alternating between the two queries', async () => {
    const { venice, say, cards } = setup();
    venice.onBreakdown(() => ({
      claims: [claim('The deficit is the largest in history', { fact: 'federal deficit by year', claim: 'largest deficit in history Example' })],
      skipped: [],
    }));
    const long = (tag: string) => `${tag} ${'x'.repeat(600)}`;
    venice.onSearch((query) =>
      query === 'federal deficit by year'
        ? [1, 2, 3, 4].map((i) => result('cbo.gov', `Fact ${i}`, long(`fact-${i}`)))
        : [1, 2, 3, 4].map((i) => result('reuters.com', `Claim ${i}`, long(`claim-${i}`))),
    );
    let asked = '';
    venice.onVerdict(({ user }) => {
      asked = user;
      return { literal: '', implied: '', evidence: '', conclusion: 'The CBO figures show it is not the largest.', label: 'False', missing: null, sources: [] };
    });

    say('The deficit is the largest in our history.');
    await settle();

    const verdict = cards()[0]!.check;
    if (verdict.state !== 'done') throw new Error('not judged');
    expect(verdict.verdict.sources.map((s) => s.title)).toEqual(['Fact 1', 'Claim 1', 'Fact 2', 'Claim 2', 'Fact 3']);
    expect(verdict.verdict.sources.map((s) => s.snippet.length)).toEqual([400, 400, 400, 400, 400]);
    // What the verdict step was given: those five, trimmed, and nothing else.
    for (const s of verdict.verdict.sources) expect(asked).toContain(s.snippet);
    expect(asked).not.toContain('Claim 3');
    expect(asked).not.toContain('x'.repeat(401));
  });

  it("shows each source's stance from the verdict", async () => {
    const { venice, say, cards } = setup();
    venice.onBreakdown(() => ({ claims: [claim('Crime doubled this year')], skipped: [] }));
    venice.onSearch((query) => (query.includes('figures') ? [result('fbi.gov', 'FBI crime data')] : [result('apnews.com', 'AP crime story')]));
    venice.onVerdict(() => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'Police data show a 4% rise, not a doubling.',
      label: 'False',
      missing: null,
      sources: [
        { source: 1, stance: 'contradicts' },
        { source: 2, stance: 'neither' },
      ],
    }));

    say('Crime doubled this year.');
    await settle();

    const check = cards()[0]!.check;
    expect(check).toMatchObject({
      state: 'done',
      verdict: {
        label: 'False',
        conclusion: 'Police data show a 4% rise, not a doubling.',
        judgedAsOf: '2026-10-26',
        sources: [
          { n: 1, domain: 'fbi.gov', title: 'FBI crime data', stance: 'contradicts' },
          { n: 2, domain: 'apnews.com', title: 'AP crime story', stance: 'neither' },
        ],
      },
    });
  });
});

describe('checks: verdict', () => {
  it('says what is missing for Misleading', async () => {
    const { venice, say, cards } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Gas prices are down 20% since I took office')], skipped: [] }));
    venice.onVerdict(() => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'Prices are down from a later peak, not from the start of the term.',
      label: 'Misleading',
      missing: 'The 20% drop is measured from a peak in month two.',
      sources: [{ source: 1, stance: 'supports' }],
    }));

    say('Gas prices are down twenty percent since I took office.');
    await settle();

    expect(cards()[0]!.check).toMatchObject({
      state: 'done',
      verdict: { label: 'Misleading', missing: 'The 20% drop is measured from a peak in month two.' },
    });
  });

  it.each([
    ['the search finds nothing', () => []],
    ['every result is excluded or user-generated', () => [result('infowars.com', 'Infowars on it'), result('x.com', 'A post about it')]],
  ])('gives no label without sources: when %s, the card ends Unverified without asking for a verdict', async (_case, found) => {
    const { venice, say, cards } = setup();
    happyProvider(venice);
    venice.onSearch(found);
    venice.onBreakdown(() => ({ claims: [claim('Unemployment fell to 3.5% last month')], skipped: [] }));

    say('Unemployment fell to three point five percent last month.');
    await settle();

    expect(cards()[0]!.check).toMatchObject({
      state: 'done',
      verdict: { label: 'Unverified', conclusion: 'No usable sources were found for this claim.', sources: [] },
    });
    const verdicts = venice.requests.filter((r) => (r.body as { response_format?: { json_schema?: { name?: string } } })?.response_format?.json_schema?.name === 'verdict');
    expect(verdicts).toEqual([]);
  });

  it.each([
    ['True', 'No source addresses the specific figure, so it cannot be confirmed.', 'Unverified'],
    ['False', 'There is no evidence for the figure in the sources.', 'Unverified'],
    ['False', 'The official data contradict it: there is no evidence of a doubling.', 'False'],
    ['True', 'The official release gives the same 3.5% figure.', 'True'],
    ['True', 'BLS data confirm the 3.5% rate, though the cause of the drop is unclear.', 'True'],
    ['False', 'There is no evidence of a doubling; police data show a 4% rise.', 'False'],
    ['True', 'The sources do not mention the figure, so it is unclear.', 'Unverified'],
    ['True', 'According to the sources, there is no evidence for the figure.', 'Unverified'],
    ['True', 'No evidence was found; the figure is not in the sources.', 'Unverified'],
    ['True', 'Not supported: the sources are silent on the 2019 number.', 'Unverified'],
    ['True', 'The sources do not address it, so it is impossible to verify.', 'Unverified'],
    ['False', 'The sources are silent on the figure, which is not in the official release.', 'Unverified'],
    ['True', 'The official release gives the figure as 3.5%, though the cause is not supported by the sources.', 'True'],
    ['False', 'The sources report the rate was 4.1%, not 3.5%; there is no evidence of a fall.', 'False'],
  ])('labels %s with the conclusion "%s" as %s (consistency rule)', async (label, conclusion, shown) => {
    const { venice, say, cards } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Unemployment fell to 3.5% last month')], skipped: [] }));
    venice.onVerdict(() => ({ literal: '', implied: '', evidence: '', conclusion, label, missing: null, sources: [] }));

    say('Unemployment fell to three point five percent last month.');
    await settle();

    expect(cards()[0]!.check).toMatchObject({ state: 'done', verdict: { label: shown, conclusion } });
  });
});

describe('checks: card stages', () => {
  it('shows Checking with its stage: pulling out the claim, searching, weighing sources, then the label', async () => {
    const { venice, say, events } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Congress passed the bill')], skipped: [] }));

    say('Congress passed the bill.');
    await settle();

    const stages = events.flatMap((e) =>
      e.type === 'card' ? [e.card.check.state === 'checking' ? e.card.check.stage : e.card.check.verdict.label] : [],
    );
    expect(stages).toEqual(['breakdown', 'search', 'weighing', 'True']);
  });
});

describe('checks: provider errors', () => {
  it.each([
    [401, 'Authentication failed', 'key-rejected', "This couldn't be checked: the provider rejected the API key."],
    [402, 'Insufficient USD balance', 'no-credit', "This couldn't be checked: the API key has no credit left."],
  ])('a %s stops listening and says why', async (status, error, reason, conclusion) => {
    const { venice, say, cards, session, clock } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Congress passed the bill')], skipped: [] }));
    venice.onVerdict(() => ({ status, error }));

    say('Congress passed the bill.');
    await settle();
    say('Heard after the key was refused.');
    await settle();

    expect(session.snapshot().status).toMatchObject({ state: 'stopped', reason, stoppedAt: clock.now() });
    expect(cards().map((c) => c.check)).toEqual([
      { state: 'done', verdict: { label: 'Unverified', conclusion, missing: null, sources: [], judgedAsOf: '2026-10-26', judgedAsOfBasis: 'check' } },
    ]);
    // Refused once (after breakdown and the claim review), never asked again.
    expect(venice.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(3);
  });

  it("treats a 402 payment challenge (sent when the key isn't accepted at all) as a rejected key", async () => {
    const venice = createFakeVenice();
    venice.onBreakdown(() => ({ status: 402, error: 'Authentication required' }));
    const fetchWithChallenge: typeof fetch = async (input, init) => {
      const response = await venice.fetch(input, init);
      if (response.status !== 402) return response;
      return new Response(JSON.stringify({ x402Version: 2, error: 'Authentication required', accepts: [] }), { status: 402 });
    };
    const clock = createFakeClock(NOON);
    const challenged = createSession({ clock, fetch: fetchWithChallenge, newId: () => 'session-2' });
    challenged.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode: 'cloud', key: KEY } });
    challenged.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: 0, end: 4, text: 'Congress passed the bill.' } });
    await settle();

    expect(challenged.snapshot().status).toMatchObject({ state: 'stopped', reason: 'key-rejected' });
  });

  it('retries any other failure once, and carries on when the retry works', async () => {
    const { venice, say, cards, session } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Congress passed the bill')], skipped: [] }));
    venice.failNext('/augment/search', { status: 503, error: 'MODEL_AT_CAPACITY' });
    venice.failNext('/chat/completions', { status: 500, error: 'INFERENCE_FAILED' });

    say('Congress passed the bill.');
    await settle();

    expect(labels(cards())).toEqual(['True']);
    expect(session.snapshot().status.state).toBe('listening');
  });

  it.each([
    ['breakdown', '/chat/completions', 2, 'Congress passed the bill.'],
    // Two queries, each tried twice.
    ['search', '/augment/search', 4, 'Congress passed the bill'],
  ])('ends the card as Unverified, saying it could not be checked, when %s fails twice', async (_stage, path, failures, shownClaim) => {
    const { venice, say, cards, session } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Congress passed the bill')], skipped: [] }));
    venice.failNext(path, { status: 500, error: 'INFERENCE_FAILED' }, failures);

    say('Congress passed the bill.');
    await settle();

    expect(cards().map((c) => [c.claim?.literal ?? c.sentence, c.check])).toEqual([
      [
        shownClaim,
        {
          state: 'done',
          verdict: {
            label: 'Unverified',
            conclusion: "This couldn't be checked: the provider did not answer.",
            missing: null,
            sources: [],
            judgedAsOf: '2026-10-26',
            judgedAsOfBasis: 'check',
          },
        },
      ],
    ]);
    expect(session.snapshot().status.state).toBe('listening');
  });

  it('ends the card as Unverified when the verdict reply is malformed twice', async () => {
    const { venice, say, cards } = setup();
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Congress passed the bill')], skipped: [] }));
    venice.onVerdict(() => ({ label: 'Probably', conclusion: '' }));

    say('Congress passed the bill.');
    await settle();

    expect(cards()[0]!.check).toMatchObject({ state: 'done', verdict: { label: 'Unverified', conclusion: "This couldn't be checked: the provider did not answer." } });
    // Breakdown, the claim review, the verdict and its retry.
    expect(venice.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(4);
  });
});

describe('checks: judged-as-of date', () => {
  /** The verdict prompts the provider was sent. */
  const verdictPrompts = (venice: FakeVenice) =>
    venice.requests
      .map((r) => r.body as { messages?: Array<{ role: string; content: string }>; response_format?: { json_schema?: { name?: string } } })
      .filter((b) => b?.response_format?.json_schema?.name === 'verdict')
      .map((b) => b.messages!.find((m) => m.role === 'user')!.content);

  it('is the recording date when the page gives one, in the verdict prompt and on the card', async () => {
    const { venice, say, cards } = setup({ page: { recordedOn: '2024-06-27' } });
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Unemployment fell to 4.1% last month')], skipped: [] }));

    say('Unemployment fell to four point one percent last month.');
    await settle();

    expect(cards()[0]!.check).toMatchObject({ state: 'done', verdict: { judgedAsOf: '2024-06-27', judgedAsOfBasis: 'recording' } });
    const prompts = verdictPrompts(venice);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('2024-06-27');
    expect(prompts[0]).not.toContain('2026-10-26');
  });

  it.each([
    ['gives none', undefined],
    ['gives an unreadable one', 'last Tuesday'],
    ['gives one after today', '2026-11-02'],
  ])('is the day of the check when the page %s', async (_case, recordedOn) => {
    const { venice, say, cards } = setup({ page: { recordedOn } });
    happyProvider(venice);
    venice.onBreakdown(() => ({ claims: [claim('Unemployment fell to 4.1% last month')], skipped: [] }));

    say('Unemployment fell to four point one percent last month.');
    await settle();

    expect(cards()[0]!.check).toMatchObject({ state: 'done', verdict: { judgedAsOf: '2026-10-26', judgedAsOfBasis: 'check' } });
    expect(verdictPrompts(venice)[0]).toContain('2026-10-26');
  });
});

describe('checks: what leaves the device', () => {
  it('sends only the claim, ~30 s of context, title and channel, snippets and the date, only to the provider', async () => {
    const { venice, say } = setup();
    venice.onBreakdown(({ user }) =>
      user.includes('"The deficit doubled last year."')
        ? { claims: [claim('The federal deficit doubled last year', { fact: 'federal deficit 2025', claim: 'deficit doubled Example' })], skipped: [] }
        : { claims: [], skipped: [] },
    );
    venice.onSearch(() => [result('cbo.gov', 'CBO budget outlook', 'The deficit was $1.8 trillion.')]);
    venice.onVerdict(() => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'CBO figures show a small rise, not a doubling.',
      label: 'False',
      missing: null,
      sources: [{ source: 1, stance: 'contradicts' }],
    }));

    say('Long before, the speaker talked about a private family matter.', 0);
    say('Then the speaker mentioned our trade policy.', 15);
    say('The deficit doubled last year.', 40);
    await settle();

    expect(venice.requests.length).toBeGreaterThan(0);
    for (const request of venice.requests) {
      expect(new URL(request.url).origin).toBe('https://api.venice.ai');
      expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(request.text).not.toContain('abc123'); // never the page address
    }

    // Everything sent about the sentence at 0:40: nothing from more than 30 s before it.
    const aboutDeficit = venice.requests.filter((r) => /deficit/i.test(r.text));
    expect(aboutDeficit.map((r) => new URL(r.url).pathname).sort()).toEqual([
      '/api/v1/augment/search',
      '/api/v1/augment/search',
      '/api/v1/chat/completions',
      '/api/v1/chat/completions',
      '/api/v1/chat/completions',
    ]);
    for (const request of aboutDeficit) expect(request.text).not.toContain('private family matter');

    const chats = venice.requests.filter((r) => r.url === 'https://api.venice.ai/api/v1/chat/completions');
    const users = chats.map((r) => (r.body as { messages: Array<{ role: string; content: string }> }).messages.find((m) => m.role === 'user')!.content);
    const breakdownOfClaim = users.find((u) => u.includes('"The deficit doubled last year."'))!;
    expect(breakdownOfClaim).toContain('Then the speaker mentioned our trade policy.');
    expect(breakdownOfClaim).toContain('Senator Example on the economy');
    expect(breakdownOfClaim).toContain('Example News');

    const verdict = users.find((u) => u.includes('Claim to check:\n"The federal deficit doubled last year"'))!;
    expect(verdict).toContain('2026-10-26');
    expect(verdict).toContain('The deficit was $1.8 trillion.');
    expect(verdict).toContain('Then the speaker mentioned our trade policy.');

    const searches = venice.requests.filter((r) => r.url === 'https://api.venice.ai/api/v1/augment/search');
    // "last year", said on 2026-10-26: both queries carry 2025.
    expect(searches.map((r) => (r.body as { query: string }).query).sort()).toEqual(['deficit doubled Example 2025', 'federal deficit 2025']);
  });

  it("won't start listening without a key, and never calls the provider without one", async () => {
    const { venice, session, say } = setup({ apiKey: '   ' });

    say('Congress passed the bill.');
    await settle();

    expect(session.snapshot().status).toMatchObject({ state: 'stopped', reason: 'no-key' });
    expect(session.snapshot().lines).toEqual([]);
    expect(venice.requests).toEqual([]);
  });
});
