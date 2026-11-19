// Session tests for the footer's counters (what the session has used: LLM
// calls and tokens, searches, minutes of on-device speech-to-text and voice
// separation, claims checked), in both modes. The footer's estimate is made
// from these by the pure estimator (src/footprint), tested on its own.
// Tests assert only on the session's output: its events and snapshot.

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeLanguageModel } from './testing/fake-language-model';
import { createFakeVenice, type FakeVenice } from './testing/fake-venice';
import type { Mode, SessionCounters, SessionEvent } from './types';

const TAB = 7;
const KEY = 'venice-test-key-3f9a';
const PAGE = { title: 'Senator Example on the economy', url: 'https://video.example/watch?v=abc123', channel: 'Example News' };
const NOON = Date.UTC(2026, 9, 26, 12, 0, 0);

function setup(mode: Mode = 'cloud') {
  const clock = createFakeClock(NOON);
  const venice = createFakeVenice();
  const nano = createFakeLanguageModel();
  const session = createSession({ clock, fetch: venice.fetch, newId: () => 'session-1', languageModel: nano.factory });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  const start = () => session.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode, key: KEY } });
  let cueAt = 0;
  const say = (text: string) => {
    const at = cueAt;
    cueAt += 4;
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: at, end: at + 4, text } });
  };
  const counters = () => session.snapshot().counters;
  return { clock, venice, nano, session, events, start, say, counters };
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function claim(literal: string) {
  return { literal, implied: `${literal} (implied)`, premise_of: null, queries: { fact: `${literal} figures`, claim: `${literal} Example` } };
}

const TRUE_VERDICT = {
  literal: 'The literal claim.',
  implied: 'The takeaway.',
  evidence: 'The sources give the same figure.',
  conclusion: 'The official figures match what was said.',
  label: 'True',
  missing: null,
  sources: [{ source: 1, stance: 'supports' }],
};

/** One claim per sentence, called True; each query finds one source. */
function happyProvider(venice: FakeVenice) {
  venice.onBreakdown((asked) => ({ claims: [claim(/"([^"]*)"\s*$/.exec(asked.user)?.[1] ?? 'A claim')], skipped: [] }));
  venice.onSearch((query) => [{ title: `BLS on ${query}`, url: `https://bls.gov/${encodeURIComponent(query)}`, content: 'What the record shows.' }]);
  venice.onVerdict(() => TRUE_VERDICT);
}

const ZERO: SessionCounters = {
  cloudCalls: 0,
  cloudTokensIn: 0,
  cloudTokensOut: 0,
  cloudBilledUsd: 0,
  cloudBilledCalls: 0,
  onDeviceCalls: 0,
  onDeviceTokensIn: 0,
  onDeviceTokensOut: 0,
  onDeviceSeconds: 0,
  veniceSearches: 0,
  tinyfishSearches: 0,
  claims: 0,
  speechToTextMinutes: 0,
  voiceSeparationMinutes: 0,
};

describe('counters: cloud mode', () => {
  it('starts at zero', () => {
    const { start, counters } = setup();
    start();
    expect(counters()).toEqual(ZERO);
  });

  it("counts the provider's LLM calls and tokens, the searches and the claims checked", async () => {
    const { venice, start, say, counters } = setup();
    happyProvider(venice);
    venice.replyUsage({ promptTokens: 3_000, completionTokens: 300 });
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    // One breakdown, one claim review and one verdict; two queries searched.
    expect(counters()).toEqual({ ...ZERO, cloudCalls: 3, cloudTokensIn: 9_000, cloudTokensOut: 900, veniceSearches: 2, claims: 1 });
  });

  it("adds up what the provider billed, when its replies say", async () => {
    const { venice, start, say, counters } = setup();
    happyProvider(venice);
    venice.replyUsage({ promptTokens: 1_000, completionTokens: 100, costUsd: 0.0004 });
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(counters().cloudBilledCalls).toBe(3);
    expect(counters().cloudBilledUsd).toBeCloseTo(0.0012, 10);
  });
});

describe('counters: local mode', () => {
  it("counts Nano's prompts, their tokens and time on the device, and the searches; nothing for the provider's LLM", async () => {
    const { clock, venice, nano, start, say, counters } = setup('local');
    venice.onSearch((query) => [{ title: `BLS on ${query}`, url: `https://bls.gov/${encodeURIComponent(query)}`, content: 'What the record shows.' }]);
    nano.onBreakdown(() => {
      clock.advance(2_000);
      return { claims: [claim('Unemployment fell to 4.1% last month.')], skipped: [] };
    });
    nano.onVerdict(() => {
      clock.advance(8_500);
      return TRUE_VERDICT;
    });
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    const used = counters();
    expect(used).toMatchObject({ cloudCalls: 0, cloudTokensIn: 0, cloudBilledUsd: 0, onDeviceCalls: 3, veniceSearches: 2, claims: 1 });
    expect(used.onDeviceSeconds).toBeCloseTo(10.5);
    // Estimated from the text: the prompts hold at least the sentence, and the replies their JSON.
    expect(used.onDeviceTokensIn).toBeGreaterThan(20);
    expect(used.onDeviceTokensOut).toBeGreaterThan(20);
  });

  it('counts a prompt Nano crashed on as nothing, and its retry once answered', async () => {
    const { venice, nano, start, say, counters } = setup('local');
    venice.onSearch(() => []);
    nano.onBreakdown(() => ({ claims: [], skipped: [] }));
    nano.crashNext(1);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    expect(counters().onDeviceCalls).toBe(1);
  });
});

describe('counters: on-device audio', () => {
  it("counts the minutes of the tab's audio speech-to-text ran on, on the tab being listened to only", () => {
    const { session, start, counters } = setup();
    start();

    session.dispatch({ type: 'speech-to-text', tabId: TAB, seconds: 12 });
    session.dispatch({ type: 'speech-to-text', tabId: TAB, seconds: 18 });
    session.dispatch({ type: 'speech-to-text', tabId: TAB + 1, seconds: 60 });

    expect(counters().speechToTextMinutes).toBeCloseTo(0.5);
  });
});

describe('counters: across the session', () => {
  it("doesn't count a request the provider failed", async () => {
    const { venice, start, say, counters } = setup();
    happyProvider(venice);
    venice.failNext('/augment/search', { status: 500 }, 10);
    venice.failNext('/chat/completions', { status: 503 }, 1);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();

    // The breakdown failed once and its retry answered, then the claim review;
    // search failed twice, so the claim ended Unverified with no verdict call.
    expect(counters()).toMatchObject({ cloudCalls: 2, veniceSearches: 0, claims: 1 });
  });

  it('keeps counting through Clear now, and after Stop for the checks still running', async () => {
    const { venice, session, start, say, counters } = setup();
    happyProvider(venice);
    start();

    say('Unemployment fell to 4.1% last month.');
    await settle();
    session.dispatch({ type: 'clear' });
    expect(counters()).toMatchObject({ cloudCalls: 3, veniceSearches: 2, claims: 1 });

    say('Wages rose 4% last year.');
    session.dispatch({ type: 'stop', reason: 'viewer' });
    await session.settled();
    await settle();

    expect(counters()).toMatchObject({ cloudCalls: 6, veniceSearches: 4, claims: 2 });
  });

  it('sends every change to the panel as a counters event, whose fold matches the snapshot', async () => {
    const { venice, events, session, start, say } = setup();
    happyProvider(venice);
    start();

    say('Unemployment fell to 4.1% last month.');
    session.dispatch({ type: 'speech-to-text', tabId: TAB, seconds: 30 });
    await settle();

    const last = events.filter((e) => e.type === 'counters').at(-1);
    expect(last?.type === 'counters' && last.counters).toEqual(session.snapshot().counters);
    expect(session.snapshot().counters).toMatchObject({ cloudCalls: 3, veniceSearches: 2, claims: 1, speechToTextMinutes: 0.5 });
  });
});
