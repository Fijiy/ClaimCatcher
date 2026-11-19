// Session tests for the session's lifecycle: Stop letting checks in flight
// reach a label, Clear now, a new page on the same site, and the Save session
// export. As elsewhere, they drive `dispatch` and assert only on what the
// viewer would see (events, snapshots, the exported file).

import { describe, expect, it } from 'vitest';
import { exportSession, sessionFileName } from './export';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeVenice } from './testing/fake-venice';
import type { AfterStop, Card, SessionEvent, StopReason } from './types';
import { applyEvent } from './view';

const TAB = 7;
const PAGE = { title: 'Senator Example on the economy', url: 'https://video.example/watch?v=abc123', channel: 'Example News' };
const START = Date.UTC(2026, 9, 26, 15, 0, 0);

const TRUE_VERDICT = {
  literal: 'The literal claim.',
  implied: 'The takeaway.',
  evidence: 'The figures match.',
  conclusion: 'The official figures match what was said.',
  label: 'True',
  missing: null,
  sources: [{ source: 1, stance: 'supports' }],
};

function setup() {
  const clock = createFakeClock(START);
  const venice = createFakeVenice();
  venice.onBreakdown(({ user }) => ({
    claims: [{ literal: `Claim from: ${user.slice(0, 20)}`, implied: 'It implies something.', premise_of: null, queries: { fact: 'fact query', claim: 'claim query' } }],
    skipped: [],
  }));
  venice.onSearch((query) => [{ title: `BLS on ${query}`, url: 'https://www.bls.gov/news.release/empsit.nr0.htm?utm_source=x', content: 'The rate was 4.1 percent.' }]);
  venice.onVerdict(() => TRUE_VERDICT);
  const session = createSession({ clock, fetch: venice.fetch, newId: () => 'session-1' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode: 'cloud', key: 'k' } });
  let cueAt = 0;
  const say = (text: string, at = cueAt) => {
    cueAt = at + 4;
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: at, end: at + 4, text } });
  };
  return { clock, venice, session, events, say, cards: () => session.snapshot().cards };
}

/** Lets every pending check run as far as it can. */
async function flush() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A verdict the test answers when it chooses, so a check stays in flight. */
function heldVerdicts(venice: ReturnType<typeof createFakeVenice>) {
  const waiting: Array<() => void> = [];
  venice.onVerdict(() => new Promise((resolve) => waiting.push(() => resolve(TRUE_VERDICT))));
  return {
    release: () => waiting.splice(0).forEach((answer) => answer()),
    count: () => waiting.length,
  };
}

const labels = (cards: Card[]) => cards.map((c) => (c.check.state === 'done' ? c.check.verdict.label : 'checking'));

describe('session: Stop lets checks in flight finish', () => {
  it('stops at once, then the card already being checked still reaches a label, and only then is the session settled', async () => {
    const { venice, session, events, say, cards } = setup();
    const verdicts = heldVerdicts(venice);
    say('Unemployment fell to four point one percent last month.');
    await flush();
    expect(verdicts.count()).toBe(1);

    session.dispatch({ type: 'stop', reason: 'viewer' });
    expect(session.snapshot().status.state).toBe('stopped');
    expect(labels(cards())).toEqual(['checking']);
    let settled = false;
    void session.settled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);

    verdicts.release();
    await flush();

    expect(labels(cards())).toEqual(['True']);
    expect(settled).toBe(true);
    // The label arrived after "stopped", as an event the panel can fold in.
    const stoppedAt = events.findIndex((e) => e.type === 'stopped');
    expect(events.findLastIndex((e) => e.type === 'card')).toBeGreaterThan(stoppedAt);
  });

  it('is settled straight away when nothing is in flight', async () => {
    const { session } = setup();
    session.dispatch({ type: 'stop', reason: 'viewer' });
    await expect(session.settled()).resolves.toBeUndefined();
  });
});

describe('session: Clear now', () => {
  it('empties the transcript, cards and opened marks while listening, and listening carries on', async () => {
    const { session, say, cards } = setup();
    say('Unemployment fell to four point one percent last month.');
    await flush();
    expect(cards()).toHaveLength(1);

    session.dispatch({ type: 'source-opened', url: 'https://www.bls.gov/news.release/empsit.nr0.htm' });
    expect(session.snapshot().opened).toHaveLength(1);

    session.dispatch({ type: 'clear' });

    expect(session.snapshot()).toMatchObject({ status: { state: 'listening' }, lines: [], cards: [], opened: [] });
    say('Inflation has come down for six straight months.');
    await flush();
    expect(session.snapshot().lines.map((l) => l.text)).toEqual(['Inflation has come down for six straight months.']);
    expect(cards().map((c) => c.sentence)).toEqual(['Inflation has come down for six straight months.']);
  });

  it("doesn't let a check that was in flight bring a cleared card back", async () => {
    const { venice, session, say, cards } = setup();
    const verdicts = heldVerdicts(venice);
    say('Unemployment fell to four point one percent last month.');
    await flush();
    session.dispatch({ type: 'stop', reason: 'viewer' });

    session.dispatch({ type: 'clear' });
    verdicts.release();
    await session.settled();

    expect(cards()).toEqual([]);
    expect(session.snapshot()).toMatchObject({ status: { state: 'stopped' }, lines: [], cards: [] });
  });

  it('forgets what was heard: the same words said again come back as a new line', () => {
    const { session, events, say } = setup();
    say('Congress passed the bill.', 0);
    session.dispatch({ type: 'clear' });
    say('Congress passed the bill.', 0);
    expect(session.snapshot().lines.map((l) => l.text)).toEqual(['Congress passed the bill.']);
    expect(events.filter((e) => e.type === 'line')).toHaveLength(2);
  });

  it('reaches the panel as an event: a copy taken before Clear, plus the events after it, is cleared too', async () => {
    const { session, say } = setup();
    say('Unemployment fell to four point one percent last month.');
    await flush();
    let mirror = session.snapshot();
    session.subscribe((e) => (mirror = applyEvent(mirror, e)));

    session.dispatch({ type: 'clear' });

    expect(mirror).toEqual(session.snapshot());
    expect(mirror.lines).toEqual([]);
    expect(mirror.cards).toEqual([]);
  });
});

describe('session: a new page on the same site', () => {
  const NEXT = { title: 'Next video in the playlist', url: 'https://video.example/watch?v=def456' };

  it('keeps the session, follows the new page, and takes its captions even where they repeat the last page', async () => {
    const { venice, session, events, say } = setup();
    say('Congress passed the bill.', 0);

    session.dispatch({ type: 'page', tabId: TAB, page: NEXT });
    say('Congress passed the bill.', 0);
    await flush();

    expect(session.snapshot()).toMatchObject({ sessionId: 'session-1', status: { state: 'listening', page: NEXT } });
    expect(events.filter((e) => e.type === 'line')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'started')).toHaveLength(1);
    // Checks from now on are asked about the new page.
    const lastBreakdown = venice.requests.filter((r) => r.text.includes('claim_breakdown')).at(-1)!;
    expect(lastBreakdown.text).toContain(NEXT.title);
  });

  it('ignores a page change on any other tab', () => {
    const { session } = setup();
    session.dispatch({ type: 'page', tabId: TAB + 1, page: NEXT });
    expect(session.snapshot().status).toMatchObject({ page: PAGE });
  });
});

describe('session: the Save session export', () => {
  it('holds the full transcript, the claims, their verdicts and sources, and every timestamp', async () => {
    const { clock, venice, session, say } = setup();
    // The second sentence's request carries the first as context, so tell them apart by the second.
    venice.onBreakdown(({ user }) =>
      !user.includes('great country')
        ? { claims: [{ literal: 'Unemployment fell to 4.1% last month', implied: 'The economy is improving.', premise_of: null, queries: { fact: 'unemployment rate', claim: 'unemployment 4.1' } }], skipped: [] }
        : { claims: [], skipped: [{ text: 'What a great country.', reason: 'opinion' }] },
    );
    say('Unemployment fell to four point one percent last month.', 61);
    clock.advance(2_000);
    say('What a great country.', 65);
    await flush();
    clock.advance(60_000);
    session.dispatch({ type: 'stop', reason: 'viewer' });
    await session.settled();

    const file = exportSession(session.snapshot(), Date.UTC(2026, 9, 26, 15, 5, 0));

    expect(file).toEqual({
      format: 'ClaimCatcher session',
      version: 1,
      savedAt: '2026-10-26T15:05:00.000Z',
      page: PAGE,
      startedAt: '2026-10-26T15:00:00.000Z',
      stoppedAt: '2026-10-26T15:01:02.000Z',
      stopReason: 'viewer',
      transcript: [
        { time: 61, at: '1:01', heardAt: '2026-10-26T15:00:00.000Z', source: 'Captions', text: 'Unemployment fell to four point one percent last month.', skipped: [], voice: null },
        { time: 65, at: '1:05', heardAt: '2026-10-26T15:00:02.000Z', source: 'Captions', text: 'What a great country.', skipped: [{ text: 'What a great country.', reason: 'opinion' }], voice: null },
      ],
      claims: [
        {
          time: 61,
          at: '1:01',
          sentence: 'Unemployment fell to four point one percent last month.',
          claim: 'Unemployment fell to 4.1% last month',
          implied: 'The economy is improving.',
          premiseOf: null,
          // The title names one person, so they said it.
          speaker: 'Example',
          forced: false,
          verdict: {
            label: 'True',
            conclusion: 'The official figures match what was said.',
            missing: null,
            judgedAsOf: '2026-10-26',
            sources: [
              {
                n: 1,
                title: 'BLS on unemployment rate',
                // The link as the card shows it: tracking parameters stripped.
                url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
                domain: 'bls.gov',
                snippet: 'The rate was 4.1 percent.',
                published: null,
                rating: { kind: 'primary' },
                weight: 'full',
                stance: 'supports',
              },
            ],
            context: [],
          },
        },
      ],
    });
  });

  it('marks a claim whose check was still running when it was saved', async () => {
    const { venice, session, say } = setup();
    heldVerdicts(venice);
    say('Unemployment fell to four point one percent last month.');
    await flush();

    const file = exportSession(session.snapshot(), START);

    expect(file.stoppedAt).toBeNull();
    expect(file.claims).toMatchObject([{ verdict: null, checking: 'weighing' }]);
  });

  it('is named for the moment it was saved', () => {
    expect(sessionFileName(new Date(2026, 9, 26, 9, 5).getTime())).toBe('claimcatcher-session-2026-10-26-0905.json');
  });
});

describe('session: what a stop means for the viewer', () => {
  it.each<[StopReason, AfterStop]>([
    ['viewer', { canListenAgain: true, keyTrouble: false, settingsChanged: false }],
    ['local-model-unavailable', { canListenAgain: true, keyTrouble: false, settingsChanged: false }],
    // The viewer changed the settings: what the new ones need shows too.
    ['mode-changed', { canListenAgain: true, keyTrouble: false, settingsChanged: true }],
    ['search-changed', { canListenAgain: true, keyTrouble: false, settingsChanged: true }],
    ['key-changed', { canListenAgain: true, keyTrouble: false, settingsChanged: true }],
    // The icon click's grant is gone with the site or the tab, and a reopened page listens in its new tab.
    ['left-site', { canListenAgain: false, keyTrouble: false, settingsChanged: false }],
    ['tab-closed', { canListenAgain: false, keyTrouble: false, settingsChanged: false }],
    ['page-unavailable', { canListenAgain: false, keyTrouble: false, settingsChanged: false }],
    ['reopened', { canListenAgain: false, keyTrouble: false, settingsChanged: false }],
    // Fixed with the key, in Privacy & data.
    ['key-rejected', { canListenAgain: true, keyTrouble: true, settingsChanged: false }],
    ['no-credit', { canListenAgain: true, keyTrouble: true, settingsChanged: false }],
    ['no-key', { canListenAgain: true, keyTrouble: true, settingsChanged: false }],
    ['search-key-rejected', { canListenAgain: true, keyTrouble: true, settingsChanged: false }],
    ['no-search-key', { canListenAgain: true, keyTrouble: true, settingsChanged: false }],
  ])('after "%s"', (reason, expected) => {
    const { session } = setup();
    session.dispatch({ type: 'stop', reason });

    expect(session.snapshot().status).toMatchObject({ state: 'stopped', reason, after: expected });
  });
});
