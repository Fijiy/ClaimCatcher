// Session tests for where the transcript comes from: the page's captions
// first, the on-device transcript (speech-to-text of the tab's audio) when no
// caption has arrived for about 10 s while audio is flowing, and captions
// again when they come back. Tests drive `dispatch` with a fake clock and
// assert only on what the viewer sees: lines, their source tags, and the
// panel's source.

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeFilter } from './testing/fake-filter';
import { createFakeVenice, type FakeVenice } from './testing/fake-venice';
import type { SessionEvent } from './types';
import { applyEvent, emptyView } from './view';

const TAB = 7;
const PAGE = { title: 'Live: the budget debate', url: 'https://video.example/live' };

function listening({ venice = createFakeVenice() }: { venice?: FakeVenice } = {}) {
  const clock = createFakeClock(Date.UTC(2026, 9, 26, 15, 0, 0));
  const session = createSession({ clock, fetch: venice.fetch, claimFilter: createFakeFilter(), newId: () => 'session-1' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({ type: 'start', tabId: TAB, page: PAGE, settings: { mode: 'cloud', key: 'test-key' } });

  const audio = (flowing: boolean) => session.dispatch({ type: 'audio', tabId: TAB, flowing });
  const caption = (start: number, end: number, text: string) =>
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start, end, text } });
  const heard = (start: number, end: number, text: string) =>
    session.dispatch({ type: 'on-device-segment', tabId: TAB, segment: { start, end, text } });
  /** Each line as the panel tags it. */
  const tagged = () =>
    session.snapshot().lines.map((l) => `${l.source === 'captions' ? 'Captions' : 'On-device transcript'}: ${l.text}`);
  const source = () => session.snapshot().transcriptSource;
  return { clock, session, events, audio, caption, heard, tagged, source };
}

describe('session: the on-device transcript on a page without captions', () => {
  it('takes over once audio has flowed for about 10 s with no caption, showing what was heard in that time', () => {
    const { clock, audio, heard, tagged, source } = listening();
    audio(true);

    clock.advance(6_000);
    heard(0, 6, 'Folks, my inherited economy was on the brink.');
    expect(tagged()).toEqual([]);
    expect(source()).toBe('captions');

    clock.advance(4_000);
    expect(source()).toBe('on-device');
    expect(tagged()).toEqual(['On-device transcript: Folks, my inherited economy was on the brink.']);

    heard(6, 12, 'Now our economy is the envy of the world.');
    expect(tagged()).toEqual([
      'On-device transcript: Folks, my inherited economy was on the brink.',
      'On-device transcript: Now our economy is the envy of the world.',
    ]);
    expect(source()).toBe('on-device');
  });

  it('takes over on speech with short pauses: a 3 s pause holds the count instead of starting it again', () => {
    const { clock, audio, heard, source } = listening();
    // 4 s of speech, then a pause long enough for audio to stop flowing for a moment, again and again.
    for (let t = 0; t < 4; t++) {
      audio(true);
      clock.advance(4_000);
      heard(t * 7, t * 7 + 4, `Sentence ${t + 1}.`);
      audio(false);
      clock.advance(3_000);
    }
    // 16 s of speech without a caption, in 28 s.
    expect(source()).toBe('on-device');
  });
});

describe('session: captions first', () => {
  it('shows only captions while they keep coming, however long audio flows', () => {
    const { clock, audio, caption, heard, tagged, source, events } = listening();
    audio(true);

    for (let t = 0; t < 60; t += 5) {
      caption(t, t + 5, `Caption at ${t} seconds.`);
      heard(t, t + 5, `Heard at ${t} seconds.`);
      clock.advance(5_000);
    }

    expect(tagged()).toHaveLength(12);
    expect(tagged().every((line) => line.startsWith('Captions: '))).toBe(true);
    expect(source()).toBe('captions');
    expect(events.some((e) => e.type === 'transcript-source')).toBe(false);
  });

  it('switches to the on-device transcript about 10 s after captions stop, from where they stopped', () => {
    const { clock, audio, caption, heard, tagged, source } = listening();
    audio(true);
    caption(0, 4, 'The deficit is the largest in our history.');
    heard(0, 4, 'The deficit is the largest in our history.');
    clock.advance(4_000);

    // The captions stop; speech-to-text goes on.
    heard(4, 9, 'Unemployment fell to 4.1% last month.');
    clock.advance(5_900); // 9.9 s since the last caption
    expect(source()).toBe('captions');
    expect(tagged()).toEqual(['Captions: The deficit is the largest in our history.']);

    clock.advance(100);
    expect(source()).toBe('on-device');
    heard(9, 14, 'Inflation came down for six straight months.');
    expect(tagged()).toEqual([
      'Captions: The deficit is the largest in our history.',
      'On-device transcript: Unemployment fell to 4.1% last month.',
      'On-device transcript: Inflation came down for six straight months.',
    ]);
  });

  it('does not repeat captioned words when the on-device piece that takes over began before captions stopped', () => {
    const { clock, audio, caption, heard, tagged } = listening();
    audio(true);
    caption(0, 2.3, 'And so, my fellow Americans,');
    clock.advance(10_000);
    heard(0.1, 5.2, 'And so my fellow Americans ask not.');
    heard(5.5, 8, 'What your country can do for you.');
    // Words that don't line up with the captions' end are kept: better twice than never.
    heard(8, 9, 'Ask what you can do.');

    expect(tagged()).toEqual([
      'Captions: And so, my fellow Americans,',
      'On-device transcript: ask not.',
      'On-device transcript: What your country can do for you.',
      'On-device transcript: Ask what you can do.',
    ]);
  });

  it('keeps an overlapping on-device piece whole when its words don\'t match the captions', () => {
    const { clock, audio, caption, heard, tagged } = listening();
    audio(true);
    caption(0, 3, 'GOOD EVENING, EVERYONE.');
    heard(2, 7, 'Tonight the Senate voted on the budget.');
    clock.advance(10_000);

    expect(tagged()).toEqual(['Captions: GOOD EVENING, EVERYONE.', 'On-device transcript: Tonight the Senate voted on the budget.']);
  });

  it('switches back to captions as soon as they resume', () => {
    const { clock, audio, caption, heard, tagged, source, events } = listening();
    audio(true);
    caption(0, 4, 'Good evening.');
    clock.advance(10_000);
    heard(4, 12, 'Congress passed the bill on Tuesday.');
    expect(source()).toBe('on-device');

    caption(12, 16, 'The vote was 220 to 212.');
    heard(12, 16, 'The vote was 220 to 212.');
    clock.advance(5_000);
    caption(16, 20, 'It now goes to the Senate.');

    expect(source()).toBe('captions');
    expect(tagged()).toEqual([
      'Captions: Good evening.',
      'On-device transcript: Congress passed the bill on Tuesday.',
      'Captions: The vote was 220 to 212.',
      'Captions: It now goes to the Senate.',
    ]);
    expect(events.filter((e) => e.type === 'transcript-source').map((e) => e.type === 'transcript-source' && e.source)).toEqual([
      'on-device',
      'captions',
    ]);
  });

  it('starts counting again after captions come back, and takes over again if they stop again', () => {
    const { clock, audio, caption, heard, source } = listening();
    audio(true);
    clock.advance(10_000);
    expect(source()).toBe('on-device');

    caption(10, 12, 'Back with captions.');
    clock.advance(9_000);
    expect(source()).toBe('captions');
    clock.advance(1_000);
    expect(source()).toBe('on-device');
    heard(12, 20, 'And without them again.');
  });

  it('does not count time without audio: pausing a captioned video keeps captions', () => {
    const { clock, audio, caption, heard, tagged, source } = listening();
    audio(true);
    caption(0, 4, 'Good evening.');
    clock.advance(4_000);
    audio(false); // paused
    clock.advance(60_000);
    expect(source()).toBe('captions');

    audio(true); // playing again after a long pause: the count starts over
    clock.advance(9_000);
    expect(source()).toBe('captions');
    heard(4, 12, 'Words the captions missed.');
    clock.advance(1_000);
    expect(source()).toBe('on-device');
    expect(tagged()).toEqual(['Captions: Good evening.', 'On-device transcript: Words the captions missed.']);
  });

  it('ignores on-device segments from other tabs and blank ones', () => {
    const { clock, session, audio, tagged } = listening();
    audio(true);
    clock.advance(10_000);
    session.dispatch({ type: 'on-device-segment', tabId: TAB + 1, segment: { start: 0, end: 5, text: 'Another tab.' } });
    session.dispatch({ type: 'on-device-segment', tabId: TAB, segment: { start: 5, end: 6, text: '  ' } });
    expect(tagged()).toEqual([]);
  });

  it('shows the source in the snapshot the panel mirrors, and stops switching once listening stops', () => {
    const { clock, session, events, audio, source } = listening();
    audio(true);
    clock.advance(10_000);
    expect(events.reduce(applyEvent, emptyView).transcriptSource).toBe('on-device');
    expect(events.reduce(applyEvent, emptyView)).toEqual(session.snapshot());

    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: 10, end: 12, text: 'Captions again.' } });
    session.dispatch({ type: 'stop', reason: 'viewer' });
    clock.advance(60_000);
    expect(source()).toBe('captions');
  });
});

describe('session: on-device transcript lines are checked like captions', () => {
  it('runs them through the claim filter and the checks', async () => {
    const venice = createFakeVenice();
    venice.onBreakdown(({ user }) => {
      const sentence = /"(.*)"\s*$/.exec(user)![1]!;
      return { claims: [{ literal: sentence, implied: sentence, premise_of: null, queries: { fact: sentence, claim: sentence } }], skipped: [] };
    });
    venice.onSearch(() => [{ title: 'BLS', url: 'https://www.bls.gov/x', content: 'The rate was 4.1%.' }]);
    venice.onVerdict(() => ({
      literal: 'x',
      implied: 'x',
      evidence: 'The source gives the same figure.',
      conclusion: 'The official figures match.',
      label: 'True',
      missing: null,
      sources: [{ source: 1, stance: 'supports' }],
    }));
    const { clock, session, audio, heard } = listening({ venice });
    audio(true);
    clock.advance(10_000);

    heard(10, 15, 'Thank you all for coming. Unemployment fell to 4.1% last month.');
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));

    const view = session.snapshot();
    expect(view.lines[0]?.skipped).toEqual([{ text: 'Thank you all for coming.', reason: 'not flagged as a claim' }]);
    expect(view.cards.map((c) => [c.sentence, c.time, c.check.state === 'done' && c.check.verdict.label])).toEqual([
      ['Unemployment fell to 4.1% last month.', 10, 'True'],
    ]);
  });
});

describe('session: a new page in the same tab', () => {
  it('starts the new video afresh: what was held from the old one is dropped, and old captions hide none of its words', () => {
    const { clock, session, audio, caption, heard, tagged } = listening();
    audio(true);
    caption(0, 30, 'Words from the first video.');
    heard(25, 40, 'Held from the first video.');

    session.dispatch({ type: 'page', tabId: TAB, page: { title: 'Second video', url: 'https://video.example/live2' } });
    heard(0, 5, 'Words from the first video again on the second.');
    clock.advance(10_000);

    expect(tagged()).toEqual(['Captions: Words from the first video.', 'On-device transcript: Words from the first video again on the second.']);
  });
});
