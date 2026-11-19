// Session tests for how the tab's audio is captured (spec "Capture"): the
// page's media element first; a player that blocks direct listening (media
// from another origin, DRM, a video embedded from another site) says so, and
// with tabCapture the tab's own audio is used instead. They drive `dispatch`
// and assert only on events and snapshots, as the panel sees them.

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeVenice } from './testing/fake-venice';
import type { SessionEvent } from './types';
import { applyEvent, emptyView } from './view';

const TAB = 3;
const PAGE = { title: 'Board of Supervisors, regular meeting', url: 'https://sanfrancisco.granicus.com/player/clip/1' };
const NEXT_PAGE = { title: 'Board of Supervisors, budget committee', url: 'https://sanfrancisco.granicus.com/player/clip/2' };

function setup() {
  const clock = createFakeClock(Date.UTC(2026, 9, 26));
  const session = createSession({ clock, fetch: createFakeVenice().fetch, newId: () => 's' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode: 'cloud', key: 'k' } });
  /** The on-device transcript takes over: audio flows for 10 s with no caption. */
  const uncaptioned = (from: 'page' | 'tab') => {
    session.dispatch({ type: 'audio', tabId: TAB, flowing: true, from });
    clock.advance(10_000);
  };
  const heard = (from: 'page' | 'tab', text: string, start = 0) =>
    session.dispatch({ type: 'on-device-segment', tabId: TAB, from, segment: { start, end: start + 5, text } });
  const lines = () => session.snapshot().lines.map((l) => l.text);
  return { session, events, clock, uncaptioned, heard, lines, capture: () => session.snapshot().audioCapture };
}

describe('session: how the audio is captured', () => {
  it("starts by listening to the page's own player", () => {
    const { capture } = setup();
    expect(capture()).toEqual({ via: 'page' });
    expect(emptyView.audioCapture).toEqual({ via: 'page' });
  });

  it('says when the player blocks direct listening, and why', () => {
    const { session, capture } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'cross-origin' } });
    expect(capture()).toEqual({ via: 'blocked', why: 'cross-origin' });

    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'embed' } });
    expect(capture()).toEqual({ via: 'blocked', why: 'embed' });
  });

  it("switches to the tab's audio once tabCapture takes over", () => {
    const { session, capture } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'cross-origin' } });
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'tab' } });
    expect(capture()).toEqual({ via: 'tab' });
  });

  it("a new page on the same site forgets the old page's blocked player, but tab audio carries on", () => {
    const { session, capture } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'drm' } });
    session.dispatch({ type: 'page', tabId: TAB, page: NEXT_PAGE });
    expect(capture()).toEqual({ via: 'page' });

    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'tab' } });
    session.dispatch({ type: 'page', tabId: TAB, page: PAGE });
    expect(capture()).toEqual({ via: 'tab' });
  });

  it('reports a change once, and the panel folding the events agrees with the snapshot', () => {
    const { session, events } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'cross-origin' } });
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'cross-origin' } });
    session.dispatch({ type: 'page', tabId: TAB, page: NEXT_PAGE });

    expect(events.filter((e) => e.type === 'audio-capture').map((e) => e.type === 'audio-capture' && e.capture)).toEqual([
      { via: 'blocked', why: 'cross-origin' },
      { via: 'page' },
    ]);
    expect(events.reduce(applyEvent, emptyView)).toEqual(session.snapshot());
  });

  it("hears only the tab's audio once tabCapture runs: what the page's player still sends is ignored", () => {
    const { session, uncaptioned, heard, lines, capture } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'cross-origin' } });
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'tab' } });
    uncaptioned('tab');

    heard('page', 'Words from the page player.');
    heard('tab', 'Words from the whole tab.', 5);
    session.dispatch({ type: 'audio', tabId: TAB, flowing: false, from: 'page' });
    // A blocked report from the page changes nothing either: tabCapture hears the tab whatever its players do.
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'embed' } });

    expect(lines()).toEqual(['Words from the whole tab.']);
    expect(capture()).toEqual({ via: 'tab' });
  });

  it("hears the page's player again once tabCapture ends", () => {
    const { session, uncaptioned, heard, lines } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'tab' } });
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'page' } }); // the tab's stream ended
    uncaptioned('page');

    heard('page', 'Words from the page player.');

    expect(lines()).toEqual(['Words from the page player.']);
  });

  it("drops the blocked-player notice once the page's own player is heard after all (another one started playing)", () => {
    const { session, capture } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'cross-origin' } });

    session.dispatch({ type: 'audio', tabId: TAB, flowing: true, from: 'page' });

    expect(capture()).toEqual({ via: 'page' });
  });

  it('ignores reports about another tab, and after Stop', () => {
    const { session, capture } = setup();
    session.dispatch({ type: 'audio-capture', tabId: TAB + 1, capture: { via: 'tab' } });
    expect(capture()).toEqual({ via: 'page' });

    session.dispatch({ type: 'stop', reason: 'viewer' });
    session.dispatch({ type: 'audio-capture', tabId: TAB, capture: { via: 'blocked', why: 'cross-origin' } });
    expect(capture()).toEqual({ via: 'page' });
  });
});
