// Session tests for the on-device claim filter and forced checks. The filter
// is a fake worker client (testing/fake-filter.ts) and the provider a fake
// `fetch` (testing/fake-venice.ts). Tests assert only on what the viewer would
// see (events and snapshots) and on what left the device (recorded requests).

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeFilter, type FakeFilter } from './testing/fake-filter';
import { createFakeVenice, type FakeVenice } from './testing/fake-venice';
import type { Card, SessionEvent } from './types';

const TAB = 7;
const PAGE = { title: 'Senator Example on the economy', url: 'https://video.example/watch?v=abc123', channel: 'Example News' };

function setup(filter: FakeFilter = createFakeFilter()) {
  const clock = createFakeClock(Date.UTC(2026, 9, 26, 12, 0, 0));
  const venice = createFakeVenice();
  happyProvider(venice);
  const session = createSession({ clock, fetch: venice.fetch, claimFilter: filter, newId: () => 'session-1' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode: 'cloud', key: 'venice-test-key' } });
  let cueAt = 0;
  const say = (text: string) => {
    const at = cueAt;
    cueAt += 4;
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: at, end: at + 4, text } });
  };
  const lines = () => session.snapshot().lines;
  const cards = () => session.snapshot().cards;
  /** What was sent to the provider's LLM and search, as text. */
  const sent = () => venice.requests.map((r) => r.text).join('\n');
  return { clock, venice, filter, session, events, say, lines, cards, sent };
}

/** Lets every pending check run to completion. */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Breakdown turns the sentence into one claim with its own words; search finds a source; the verdict is True. */
function happyProvider(venice: FakeVenice) {
  venice.onBreakdown(({ user }) => {
    const sentence = /"(.*)"\s*$/.exec(user)![1]!;
    return { claims: [{ literal: sentence, implied: `${sentence} (implied)`, premise_of: null, queries: { fact: sentence, claim: sentence } }], skipped: [] };
  });
  venice.onSearch((query) => [{ title: `BLS on ${query}`, url: 'https://www.bls.gov/x', content: 'What the record shows.' }]);
  venice.onVerdict(() => ({
    literal: 'The literal claim.',
    implied: 'The takeaway.',
    evidence: 'The source gives the same figure.',
    conclusion: 'The official figures match what was said.',
    label: 'True',
    missing: null,
    sources: [{ source: 1, stance: 'supports' }],
  }));
}

const labels = (cards: Card[]) => cards.map((c) => (c.check.state === 'done' ? c.check.verdict.label : 'checking'));

describe('claim filter', () => {
  it('skips a sentence the filter drops, with the generic reason, and sends nothing about it', async () => {
    const { say, lines, cards, sent } = setup();

    say('Thank you all for coming today.');
    await settle();

    expect(lines()[0]?.skipped).toEqual([{ text: 'Thank you all for coming today.', reason: 'not flagged as a claim' }]);
    expect(cards()).toEqual([]);
    expect(sent()).not.toContain('Thank you all');
  });

  it('checks the sentences it passes, and only those', async () => {
    const { say, lines, cards, sent } = setup();

    say('Thank you all for coming today. Unemployment fell to 4.1% last month.');
    say('God bless you.');
    await settle();

    expect(cards().map((c) => c.sentence)).toEqual(['Unemployment fell to 4.1% last month.']);
    expect(labels(cards())).toEqual(['True']);
    expect(lines().map((l) => l.skipped)).toEqual([
      [{ text: 'Thank you all for coming today.', reason: 'not flagged as a claim' }],
      [{ text: 'God bless you.', reason: 'not flagged as a claim' }],
    ]);
    expect(sent()).not.toContain('God bless');
  });

  it("gives breakdown's own reasons, not the generic one, to what breakdown skips", async () => {
    const { venice, say, lines, cards } = setup();
    venice.onBreakdown(() => ({ claims: [], skipped: [{ text: 'We will cut taxes by 20% next year.', reason: 'promise' }] }));

    say('We will cut taxes by 20% next year.');
    await settle();

    expect(lines()[0]?.skipped).toEqual([{ text: 'We will cut taxes by 20% next year.', reason: 'promise' }]);
    expect(cards()).toEqual([]);
  });

  it('lets a sentence through when the on-device model fails, rather than dropping it unseen', async () => {
    const filter = createFakeFilter(() => false);
    filter.failNext();
    const { say, lines, cards } = setup(filter);

    say('Thank you all for coming today.');
    await settle();

    expect(labels(cards())).toEqual(['True']);
    expect(lines()[0]?.skipped).toBeUndefined();
  });
});

describe('forced checks', () => {
  it('checks a line the filter skipped, from claim breakdown on, and tags the card "You asked to check this"', async () => {
    const { session, say, lines, cards, sent } = setup();
    say('And that is twice what the Senate version would spend.');
    await settle();
    expect(cards()).toEqual([]);

    session.dispatch({ type: 'force-check', lineId: lines()[0]!.id });
    await settle();

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({ lineId: lines()[0]!.id, time: 0, forced: true, sentence: 'And that is twice what the Senate version would spend.' });
    expect(labels(cards())).toEqual(['True']);
    expect(sent()).toContain('And that is twice what the Senate version would spend.');
  });

  it('ends a forced check on an opinion in one of the four labels, even when breakdown finds no claim in it', async () => {
    const { venice, session, say, lines, cards } = setup();
    venice.onBreakdown(() => ({ claims: [], skipped: [{ text: 'This is the greatest country on earth.', reason: 'opinion' }] }));
    say('This is the greatest country on earth.');
    await settle();

    session.dispatch({ type: 'force-check', lineId: lines()[0]!.id });
    await settle();

    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.forced).toBe(true);
    expect(cards()[0]?.claim?.literal).toBe('This is the greatest country on earth.');
    expect(labels(cards())).toEqual(['True']);
  });

  it('ends in Unverified, still tagged, when the provider fails', async () => {
    const { venice, session, say, lines, cards } = setup();
    say('Thank you all for coming today.');
    await settle();
    venice.failNext('/chat/completions', { status: 500 }, 10);

    session.dispatch({ type: 'force-check', lineId: lines()[0]!.id });
    await settle();

    expect(labels(cards())).toEqual(['Unverified']);
    expect(cards()[0]?.forced).toBe(true);
  });

  it('checks a line only once however often it is asked, and not after listening stops', async () => {
    const { session, say, lines, cards } = setup();
    say('Thank you all for coming today.');
    say('God bless you.');
    await settle();

    session.dispatch({ type: 'force-check', lineId: lines()[0]!.id });
    session.dispatch({ type: 'force-check', lineId: lines()[0]!.id });
    session.dispatch({ type: 'stop', reason: 'viewer' });
    session.dispatch({ type: 'force-check', lineId: lines()[1]!.id });
    session.dispatch({ type: 'force-check', lineId: 'no-such-line' });
    await settle();

    expect(cards().map((c) => c.sentence)).toEqual(['Thank you all for coming today.']);
  });
});
