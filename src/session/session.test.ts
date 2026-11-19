import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeVenice } from './testing/fake-venice';
import type { CaptionSegment, SessionEvent } from './types';
import { applyEvent } from './view';

const TAB = 7;
const PAGE = { title: 'Floor speech', url: 'https://example.test/watch' };

function cue(start: number, end: number, text: string): CaptionSegment {
  return { reader: 'track', start, end, text };
}

function listening() {
  const clock = createFakeClock(Date.UTC(2026, 9, 26, 15, 0, 0));
  // A provider that finds no claims: these tests are about the transcript.
  const session = createSession({ clock, fetch: createFakeVenice().fetch, newId: () => 'session-1' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode: 'cloud', key: 'test-key' } });
  const lines = () => events.flatMap((e) => (e.type === 'line' ? [e.line] : []));
  return { clock, session, events, lines };
}

describe('session: captions to transcript lines', () => {
  it('emits each caption cue as a timed transcript line tagged Captions', () => {
    const { clock, session, lines } = listening();

    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(0, 4, 'The unemployment rate fell to four point one percent last month.') });
    clock.advance(4_000);
    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(4, 7.5, 'Inflation has come down for six straight months.') });

    expect(lines().map(({ time, text, source, heardAt }) => ({ time, text, source, heardAt }))).toEqual([
      {
        time: 0,
        text: 'The unemployment rate fell to four point one percent last month.',
        source: 'captions',
        heardAt: Date.UTC(2026, 9, 26, 15, 0, 0),
      },
      {
        time: 4,
        text: 'Inflation has come down for six straight months.',
        source: 'captions',
        heardAt: Date.UTC(2026, 9, 26, 15, 0, 4),
      },
    ]);
  });

  it('shows a cue the reader reports twice as one line', () => {
    const { session, lines } = listening();

    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(12, 15.9, 'The deficit is the largest in our history.') });
    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(12, 15.9, 'The deficit is the largest in our history.') });

    expect(lines().map((l) => l.text)).toEqual(['The deficit is the largest in our history.']);
  });

  it('ignores captions from any tab but the one it is listening to', () => {
    const { session, lines } = listening();

    session.dispatch({ type: 'caption', tabId: TAB + 1, segment: cue(0, 4, 'Heard on another tab.') });

    expect(lines()).toEqual([]);
  });
});

describe('session: stopping', () => {
  it('reports when and why it stopped, takes no more lines, and keeps the transcript', () => {
    const { clock, session, events, lines } = listening();
    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(0, 4, 'Congress passed the bill.') });

    clock.advance(30_000);
    session.dispatch({ type: 'stop', reason: 'viewer' });
    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(4, 8, 'Heard after Stop.') });

    expect(events.at(-1)).toMatchObject({ type: 'stopped', reason: 'viewer', stoppedAt: Date.UTC(2026, 9, 26, 15, 0, 30) });
    expect(lines().map((l) => l.text)).toEqual(['Congress passed the bill.']);
    expect(session.snapshot()).toMatchObject({
      status: { state: 'stopped', reason: 'viewer', startedAt: Date.UTC(2026, 9, 26, 15, 0, 0) },
      lines: [{ text: 'Congress passed the bill.', time: 0 }],
    });
  });
});

describe('session: snapshot', () => {
  it('lets a late viewer catch up: a snapshot plus the events after it equals the live state', () => {
    const { session } = listening();
    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(0, 4, 'First line.') });

    let mirror = session.snapshot();
    session.subscribe((e) => (mirror = applyEvent(mirror, e)));
    session.dispatch({ type: 'caption', tabId: TAB, segment: cue(4, 8, 'Second line.') });
    session.dispatch({ type: 'stop', reason: 'viewer' });

    expect(mirror).toEqual(session.snapshot());
    expect(mirror.lines.map((l) => l.text)).toEqual(['First line.', 'Second line.']);
  });
});
