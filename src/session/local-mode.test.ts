// Session tests for local mode: Gemini Nano (a fake `LanguageModel` factory,
// testing/fake-language-model.ts) breaks sentences down and judges claims on
// the device; only search goes to the provider (testing/fake-venice.ts).
// Tests assert on what the viewer would see (events, snapshots), on what left
// the device (the provider's recorded requests) and on how many prompts Nano
// got (the spec rules out follow-up prompts; the fake crashes on one).

import { describe, expect, it } from 'vitest';
import { NANO_TIMEOUT_MS } from './checks/nano';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeLanguageModel, type FakeLanguageModel } from './testing/fake-language-model';
import { createFakeVenice, KEEP, type FakeVenice } from './testing/fake-venice';
import type { Card, PageContext, SessionDeps, SessionEvent } from './types';

const TAB = 7;
const KEY = 'venice-test-key-3f9a';
const PAGE = { title: 'Senator Example on the economy', url: 'https://video.example/watch?v=abc123', channel: 'Example News' };
const NOON = Date.UTC(2026, 9, 26, 12, 0, 0);

function setup(options: { languageModel?: SessionDeps['languageModel'] | null; nano?: FakeLanguageModel; page?: Partial<PageContext> } = {}) {
  const clock = createFakeClock(NOON);
  const venice = createFakeVenice();
  const nano = options.nano ?? createFakeLanguageModel();
  const languageModel = options.languageModel === null ? undefined : (options.languageModel ?? nano.factory);
  const session = createSession({ clock, fetch: venice.fetch, newId: () => 'session-1', languageModel });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  const page = { ...PAGE, ...options.page };
  const start = () => session.dispatch({ type: 'start', tabId: TAB, page, settings: { mode: 'local', key: KEY } });
  let cueAt = 0;
  const say = (text: string) => {
    const at = cueAt;
    cueAt += 4;
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: at, end: at + 4, text } });
  };
  const cards = () => session.snapshot().cards;
  return { clock, venice, nano, session, events, start, say, cards };
}

/** Lets every pending check run to completion. */
async function settle() {
  for (let i = 0; i < 150; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function claim(literal: string) {
  return { literal, implied: `${literal} (implied)`, premise_of: null, queries: { fact: `${literal} figures`, claim: `${literal} Example` } };
}

function result(domain: string, title: string) {
  return { title, url: `https://${domain}/${title.toLowerCase().replace(/\W+/g, '-')}`, content: `${title}: what the record shows.` };
}

const TRUE_VERDICT = {
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
};

/** Nano finds one claim per sentence and calls it True; search finds two sources per query. */
function happy(nano: FakeLanguageModel, venice: FakeVenice) {
  nano.onBreakdown((user) => ({ claims: [claim(/"([^"]*)"\s*$/.exec(user)![1]!)], skipped: [] }));
  nano.onVerdict(() => TRUE_VERDICT);
  venice.onSearch((query) => [result('bls.gov', `BLS on ${query}`), result('apnews.com', `AP on ${query}`)]);
}

const labels = (cards: Card[]) => cards.map((c) => (c.check.state === 'done' ? c.check.verdict.label : 'checking'));
const verdictOf = (card: Card | undefined) => (card?.check.state === 'done' ? card.check.verdict : undefined);
const conclusion = (card: Card | undefined) => verdictOf(card)?.conclusion;

describe('local mode: Gemini Nano judges on the device', () => {
  it('breaks down and judges claims with Nano; only search queries go to the provider', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(labels(cards())).toEqual(['True']);
    expect(cards()[0]?.claim?.literal).toBe('Unemployment fell to 4.1% last month.');
    // Nano was asked to break the sentence down, to review the claim and to judge it.
    expect(nano.sessions.flatMap((s) => s.prompts)).toHaveLength(3);
    // Nothing but the two searches left the device, both to the provider's search.
    expect(venice.requests.map((r) => new URL(r.url).href)).toEqual([
      'https://api.venice.ai/api/v1/augment/search',
      'https://api.venice.ai/api/v1/augment/search',
    ]);
    expect(venice.requests.map((r) => (r.body as { query: string }).query).sort()).toEqual([
      'Unemployment fell to 4.1% last month. Example',
      'Unemployment fell to 4.1% last month. figures',
    ]);
  });
});

describe('local mode: Nano settings and sessions', () => {
  it('gives every prompt a fresh session: never a follow-up prompt', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    start();

    say('Unemployment fell to 4.1% last month.');
    say('Wages rose 4% last year.');
    say('Prices rose 3% in March.');
    await settle();

    // A follow-up prompt would have crashed the fake Nano.
    expect(labels(cards())).toEqual(['True', 'True', 'True']);
    // Nine prompts (three breakdowns, three claim reviews, three verdicts), each in its own session.
    const prompted = nano.sessions.filter((s) => s.prompts.length > 0);
    expect(prompted).toHaveLength(9);
    for (const s of prompted) expect(s.prompts).toHaveLength(1);
  });

  it('sends Nano one prompt at a time', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    nano.onBreakdown((user) =>
      /Wages rose/.test(/Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '')
        ? { claims: [claim('Wages rose 4% last year'), claim('Prices rose 3% in March')], skipped: [] }
        : { claims: [claim('Unemployment fell last month'), claim('Unemployment is 4.1%')], skipped: [] },
    );
    start();

    say('Wages rose 4% last year and prices rose 3% in March.');
    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(labels(cards())).toEqual(['True', 'True', 'True', 'True']);
    expect(nano.maxConcurrentPrompts()).toBe(1);
  });
});

describe('local mode: the crash path', () => {
  it('after a crash, rebuilds the session and retries once', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    start();

    say('Unemployment fell to 4.1% last month.'); // breakdown runs first
    await settle();
    expect(labels(cards())).toEqual(['True']);

    nano.crashNext();
    say('Wages rose 4% last year.');
    await settle();

    // The crash took every session with it, so the retry could only answer from a rebuilt one.
    expect(labels(cards())).toEqual(['True', 'True']);
    for (const s of nano.sessions) expect(s.prompts.length).toBeLessThanOrEqual(1);
  });

  it('a second crash ends the card as Unverified, saying it couldn’t be checked, with no follow-up prompts', async () => {
    const { venice, nano, start, say, cards, session } = setup();
    happy(nano, venice);
    start();
    say('Unemployment fell to 4.1% last month.');
    await settle();
    const prompts = () => nano.sessions.flatMap((s) => s.prompts).length;
    const sent = prompts();

    // The verdict for the next claim crashes twice (breakdown and the claim review answer first).
    nano.onBreakdown((user) => ({ claims: [claim(/"([^"]*)"\s*$/.exec(user)![1]!)], skipped: [] }));
    nano.onReview(() => {
      nano.crashNext(2);
      return KEEP;
    });
    say('Wages rose 4% last year.');
    await settle();

    expect(labels(cards())).toEqual(['True', 'Unverified']);
    expect(conclusion(cards()[1])).toBe("This couldn't be checked: Gemini Nano, the model on this device, failed.");
    expect(verdictOf(cards()[1])?.sources).toEqual([]);
    // Breakdown, the claim review, then the verdict and its one retry: four prompts, each in its own session.
    expect(prompts() - sent).toBe(4);
    for (const s of nano.sessions) expect(s.prompts.length).toBeLessThanOrEqual(1);
    // Never a switch to the provider's model, and listening goes on.
    expect(venice.requests.every((r) => r.url.endsWith('/augment/search'))).toBe(true);
    expect(session.snapshot().status.state).toBe('listening');
  });

  it('a crash in claim breakdown takes the same path', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    nano.crashNext(2);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(labels(cards())).toEqual(['Unverified']);
    expect(conclusion(cards()[0])).toBe("This couldn't be checked: Gemini Nano, the model on this device, failed.");
    expect(venice.requests).toEqual([]);
  });

  it('a prompt that hangs is given up on, rebuilt and retried once, then Unverified', async () => {
    const { clock, venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    nano.hangNext(2);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();
    expect(labels(cards())).toEqual(['checking']);

    clock.advance(NANO_TIMEOUT_MS);
    await settle();
    expect(labels(cards())).toEqual(['checking']); // the retry is running
    clock.advance(NANO_TIMEOUT_MS);
    await settle();

    expect(labels(cards())).toEqual(['Unverified']);
    expect(conclusion(cards()[0])).toBe("This couldn't be checked: Gemini Nano, the model on this device, failed.");
    // The prompt and its one retry, nothing more.
    expect(nano.sessions.filter((s) => s.prompts.length > 0)).toHaveLength(2);
  });

  it('one hang, then an answer: the retry labels the card', async () => {
    const { clock, venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    nano.hangNext();
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();
    clock.advance(NANO_TIMEOUT_MS);
    await settle();

    expect(labels(cards())).toEqual(['True']);
  });
});

describe('local mode: a real device’s first prompts', () => {
  it('waits for the model to load after the download, without counting it against the prompt time limit', async () => {
    const { clock, venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    // The first session after the download loads Nano, which can take minutes.
    nano.slowLoad(() => new Promise((resolve) => clock.setTimeout(resolve, 2 * NANO_TIMEOUT_MS)));
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();
    nano.slowLoad(async () => {}); // loaded once, the model stays loaded
    clock.advance(NANO_TIMEOUT_MS);
    await settle();
    expect(labels(cards())).toEqual(['checking']);
    clock.advance(NANO_TIMEOUT_MS);
    await settle();

    expect(labels(cards())).toEqual(['True']);
  });

  it('if Chrome refuses every response schema, the check ends Unverified: Nano is never asked without one', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    // Chrome takes no schema at all; only an unconstrained prompt would be answered.
    nano.refuseSchemas((schema) => schema === undefined);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(labels(cards())).toEqual(['Unverified']);
    expect(conclusion(cards()[0])).toBe("This couldn't be checked: Gemini Nano, the model on this device, failed.");
  });

  it('labels the cards when Chrome takes only a simpler schema', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    nano.refuseSchemas((schema) => schema !== undefined && !JSON.stringify(schema).includes('enum'));
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();
    say('Inflation came down for six straight months.');
    await settle();

    expect(labels(cards())).toEqual(['True', 'True']);
  });
});

describe('local mode: availability', () => {
  it('stops at once, sending nothing, where the browser has no built-in model', async () => {
    const { venice, start, say, session, events } = setup({ languageModel: null });
    start();
    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(session.snapshot().status).toMatchObject({ state: 'stopped', reason: 'local-model-unavailable' });
    expect(events.map((e) => e.type)).toEqual(['started', 'stopped']);
    expect(venice.requests).toEqual([]);
  });

  it.each(['unavailable', 'downloadable', 'downloading'] as const)('stops when Nano is %s, and never falls back to cloud mode', async (availability) => {
    const nano = createFakeLanguageModel();
    nano.setAvailability(availability);
    const { venice, start, session } = setup({ nano });
    start();
    await settle();

    expect(session.snapshot().status).toMatchObject({ state: 'stopped', reason: 'local-model-unavailable' });
    expect(venice.requests).toEqual([]);
    expect(nano.sessions).toEqual([]);
  });
});

describe('local mode: replies held to plain JSON types', () => {
  it('reads an empty or "null" answer in a field that may be null as no value', async () => {
    const { venice, nano, start, say, cards } = setup();
    happy(nano, venice);
    nano.onBreakdown(() => ({ claims: [{ ...claim('Wages rose 4% last year'), premise_of: 'null' }], skipped: [] }));
    nano.onVerdict(() => ({ ...TRUE_VERDICT, label: 'Misleading', missing: '' }));
    start();

    say('Wages rose 4% last year.');
    await settle();

    expect(cards()[0]?.claim?.premiseOf).toBeNull();
    expect(verdictOf(cards()[0])).toMatchObject({ label: 'Misleading', missing: null });
  });
});

describe('local mode: who said it', () => {
  it('shows Nano the description, so a speaker named only there is trusted; the provider never sees it', async () => {
    const description = 'Governor Maria Lopez speaks in Columbus.';
    const { venice, nano, start, say, cards } = setup({ page: { title: 'Remarks on jobs', channel: 'Ohio Public Media', description } });
    happy(nano, venice);
    nano.onBreakdown(() => ({
      people_named: ['Maria Lopez'],
      claims: [
        {
          ...claim('Maria Lopez has created more jobs than any of her predecessors'),
          depends_on_speaker: true,
          speaker_words: 'I',
          speaker: 'Maria Lopez',
        },
      ],
      skipped: [],
    }));
    start();

    say("I've created more jobs than any of my predecessors.");
    await settle();

    expect(cards()[0]?.speaker).toEqual({ name: 'Maria Lopez', from: 'page' });
    expect(cards()[0]?.whoSaid).toBeUndefined();
    expect(labels(cards())).toEqual(['True']);
    expect(venice.requests.length).toBeGreaterThan(0);
    for (const request of venice.requests) expect(JSON.stringify(request.body)).not.toContain('Columbus');
  });
});
