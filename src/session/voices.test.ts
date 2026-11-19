// Session tests for voice separation (spec stories 53-55): in a debate each
// voice is told apart on the device, the viewer is asked "Who is this?" the
// first time a new voice makes a claim, and later cards from that voice carry
// the name. Voice tags come in as the worker would send them (fake voice-tagged
// segments and voice turns); the provider is a fake `fetch`. Tests assert only
// on what the viewer sees (lines, cards, voices) and on what left the device.

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeVenice, type Asked, type FakeVenice } from './testing/fake-venice';
import type { Card, PageContext, SessionEvent, SessionView, VoiceTurn } from './types';
import { exportSession } from './export';
import { applyEvent, emptyView, voiceText as shownVoice } from './view';

const TAB = 7;
const NOON = Date.UTC(2026, 9, 26, 12, 0, 0);
const DEBATE: PageContext = {
  title: 'Lopez vs. Hart: the second governor debate',
  url: 'https://video.example/watch?v=debate',
  channel: 'Ohio Public Media',
  description: 'Democratic nominee Maria Lopez and Republican nominee Daniel Hart meet in Columbus.',
};

function setup(page: PageContext = DEBATE) {
  const clock = createFakeClock(NOON);
  const venice = createFakeVenice();
  const session = createSession({ clock, fetch: venice.fetch, separatesVoices: true, newId: () => 'session-1' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({ type: 'start', tabId: TAB, page, settings: { mode: 'cloud', key: 'k' } });
  happyProvider(venice);

  /** An uncaptioned page: audio flows for 10 s with no caption, so the on-device transcript takes over. */
  const uncaptioned = () => {
    session.dispatch({ type: 'audio', tabId: TAB, flowing: true });
    clock.advance(10_000);
  };
  let at = 0;
  /** An on-device transcript segment, tagged with the voice the worker told apart. */
  const heard = (text: string, voice?: string) => {
    session.dispatch({ type: 'on-device-segment', tabId: TAB, segment: { start: at, end: at + 5, text, ...(voice ? { voice } : {}) } });
    at += 5;
  };
  /** A caption cue, untagged: the page's captions know nothing of voices. */
  const caption = (text: string) => {
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: at, end: at + 4, text } });
    at += 4;
  };
  /** The worker's voice turns for a stretch of the tab's audio. */
  const voices = (start: number, end: number, turns: VoiceTurn[], merged?: Array<{ voice: string; into: string }>) =>
    session.dispatch({ type: 'voices', tabId: TAB, span: { start, end }, turns, ...(merged ? { merged } : {}) });
  const cards = () => session.snapshot().cards;
  const view = () => session.snapshot();
  return { clock, venice, session, events, uncaptioned, heard, caption, voices, cards, view, now: () => at };
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A claim as claim breakdown answers it. */
function claim(literal: string, speaker: { depends?: boolean; name?: string | null } = {}) {
  return {
    literal,
    implied: `${literal} (implied)`,
    premise_of: null,
    depends_on_speaker: speaker.depends ?? false,
    speaker_words: speaker.depends ? 'I' : null,
    speaker: speaker.name ?? null,
    queries: { fact: `${literal} figures`, claim: literal },
  };
}

function happyProvider(venice: FakeVenice) {
  venice.onSearch((query) => [{ title: `BLS on ${query}`, url: 'https://www.bls.gov/jobs', content: 'Payrolls grew.' }]);
  venice.onVerdict(() => ({
    literal: '',
    implied: '',
    evidence: '',
    conclusion: 'The figures back it.',
    label: 'True',
    missing: null,
    sources: [{ source: 1, stance: 'supports' }],
  }));
}

/**
 * Breakdown as a model would answer a debate: "I" can't be resolved from the
 * page (two people), unless a speaker is named in the prompt. Sentences with
 * "I" depend on the speaker; others don't.
 */
function debateBreakdown(venice: FakeVenice) {
  venice.onBreakdown(({ user }: Asked) => {
    const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1];
    const named = /Speaker \(named by the viewer\): "(.*?)"/.exec(user)?.[1];
    const said = SAID.find((s) => s.text === sentence);
    if (!said) return { people_named: ['Lopez', 'Hart'], claims: [], skipped: [] };
    if (!said.depends) return { people_named: ['Lopez', 'Hart'], claims: [claim(said.claim)], skipped: [] };
    const who = named ?? 'The speaker';
    return { people_named: ['Lopez', 'Hart'], claims: [claim(`${who} ${said.claim}`, { depends: true, name: named ?? null })], skipped: [] };
  });
}

const SAID = [
  { text: 'I created forty thousand jobs.', claim: 'created 40,000 jobs', depends: true },
  { text: 'I cut taxes for every family.', claim: 'cut taxes for every family', depends: true },
  { text: 'I balanced the budget twice.', claim: 'balanced the budget twice', depends: true },
  { text: 'Ohio added forty thousand jobs last year.', claim: 'Ohio added 40,000 jobs last year', depends: false },
  { text: 'Unemployment fell to four percent.', claim: 'Unemployment fell to 4%', depends: false },
];

const label = (card: Card | undefined) => (card?.check.state === 'done' ? card.check.verdict.label : 'checking');
/** What the viewer reads for a voice: its name if given, else "Voice A". */
const voiceText = (view: SessionView, id: string | undefined) => shownVoice(view.voices, id);

describe('voice separation: tags', () => {
  it('tags each on-device line with its voice, lettered in the order the voices were first heard', () => {
    const { uncaptioned, heard, view } = setup();
    uncaptioned();

    heard('Good evening and welcome.', 'v7');
    heard('Thank you for having me.', 'v3');
    heard('Glad to be here.', 'v7');

    expect(view().lines.map((l) => [l.text, voiceText(view(), l.voice)])).toEqual([
      ['Good evening and welcome.', 'Voice A'],
      ['Thank you for having me.', 'Voice B'],
      ['Glad to be here.', 'Voice A'],
    ]);
  });

  it('is on by default once the transcript comes from on-device speech-to-text, and off on captioned pages', () => {
    const { uncaptioned, caption, view } = setup();
    caption('Good evening.');
    expect(view().voiceSeparation).toBe(false);

    uncaptioned();
    expect(view().transcriptSource).toBe('on-device');
    expect(view().voiceSeparation).toBe(true);
  });

  it('can be rebuilt by the panel from the events alone', async () => {
    const { uncaptioned, heard, events, session, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();
    expect(events.reduce(applyEvent, emptyView)).toEqual(session.snapshot());
  });
});

describe('voice separation: "Who is this?"', () => {
  it('asks once per new voice, on its first claim, with the names on the page; the claim waits for the answer', async () => {
    const { uncaptioned, heard, cards, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();

    heard('I created forty thousand jobs.', 'v1');
    await settle();
    heard('Ohio added forty thousand jobs last year.', 'v1');
    await settle();

    const [first, second] = cards();
    expect(first?.whoIsThis).toEqual({ voice: 'v1', names: ['Maria Lopez', 'Daniel Hart'] });
    // It depends on who "I" is: Unverified until the voice is named, and not "Who said this?" as well.
    expect(first?.whoSaid).toBeUndefined();
    expect(label(first)).toBe('Unverified');
    // The voice's later claims don't ask again.
    expect(second?.whoIsThis).toBeUndefined();
    expect(label(second)).toBe('True');
    // Nothing was searched or judged for the claim that waits.
    expect(venice.requests.filter((r) => r.url.endsWith('/augment/search')).map((r) => (r.body as { query: string }).query)).not.toContain(
      'The speaker created 40,000 jobs',
    );
  });

  it('while "Who is this?" is open, the voice\'s later claims that depend on the speaker wait on it, not on "Who said this?"', async () => {
    const { uncaptioned, heard, cards, session, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();
    heard('I cut taxes for every family.', 'v1');
    await settle();

    expect(cards().map((c) => [!!c.whoIsThis, !!c.whoSaid, label(c)])).toEqual([
      [true, false, 'Unverified'],
      [false, false, 'Unverified'],
    ]);

    session.dispatch({ type: 'voice-name', voice: 'v1', name: 'Daniel Hart' });
    await settle();
    expect(cards().map((c) => [c.claim?.literal, c.speaker?.name, label(c)])).toEqual([
      ['Daniel Hart created 40,000 jobs', 'Daniel Hart', 'True'],
      ['Daniel Hart cut taxes for every family', 'Daniel Hart', 'True'],
    ]);
  });

  it('Skip on "Who is this?" gives every claim waiting on it "Who said this?"', async () => {
    const { uncaptioned, heard, cards, session, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();
    heard('I cut taxes for every family.', 'v1');
    await settle();

    session.dispatch({ type: 'voice-skip', voice: 'v1' });

    expect(cards().map((c) => [!!c.whoIsThis, c.whoSaid?.names, label(c)])).toEqual([
      [false, ['Maria Lopez', 'Daniel Hart'], 'Unverified'],
      [false, ['Maria Lopez', 'Daniel Hart'], 'Unverified'],
    ]);
  });

  it('checks a claim that does not depend on the speaker straight away, and asks alongside it', async () => {
    const { uncaptioned, heard, cards, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();

    heard('Ohio added forty thousand jobs last year.', 'v1');
    await settle();

    expect(cards()[0]?.whoIsThis?.voice).toBe('v1');
    expect(label(cards()[0])).toBe('True');
  });

  it('naming a voice labels its cards, resolves "I" for them, and later claims from it no longer ask', async () => {
    const { uncaptioned, heard, cards, session, venice, view } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();

    session.dispatch({ type: 'voice-name', voice: 'v1', name: 'Daniel Hart' });
    await settle();
    heard('I cut taxes for every family.', 'v1');
    await settle();

    expect(cards().map((c) => [c.claim?.literal, c.speaker, !!c.whoIsThis, !!c.whoSaid, label(c)])).toEqual([
      ['Daniel Hart created 40,000 jobs', { name: 'Daniel Hart', from: 'voice' }, false, false, 'True'],
      ['Daniel Hart cut taxes for every family', { name: 'Daniel Hart', from: 'voice' }, false, false, 'True'],
    ]);
    expect(view().voices).toEqual([{ id: 'v1', label: 'Voice A', name: 'Daniel Hart' }]);
    expect(voiceText(view(), view().lines[0]?.voice)).toBe('Daniel Hart');
  });

  it('Skip leaves the voice unnamed: its claims fall back to "Who said this?", and it is not asked again', async () => {
    const { uncaptioned, heard, cards, session, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();

    session.dispatch({ type: 'voice-skip', voice: 'v1' });
    await settle();
    expect(cards()[0]?.whoIsThis).toBeUndefined();
    expect(cards()[0]?.whoSaid).toEqual({ names: ['Maria Lopez', 'Daniel Hart'] });
    expect(label(cards()[0])).toBe('Unverified');

    heard('I cut taxes for every family.', 'v1');
    await settle();
    expect(cards()[1]?.whoIsThis).toBeUndefined();
    expect(cards()[1]?.whoSaid?.names).toEqual(['Maria Lopez', 'Daniel Hart']);
    expect(cards()[1]?.speaker).toBeUndefined();

    // "Who said this?" still works on such a card.
    session.dispatch({ type: 'speaker-answer', cardId: cards()[1]!.id, name: 'Maria Lopez' });
    await settle();
    expect(cards()[1]).toMatchObject({ speaker: { name: 'Maria Lopez', from: 'viewer' }, claim: { literal: 'Maria Lopez cut taxes for every family' } });
    expect(label(cards()[1])).toBe('True');
  });

  it('asks again for each new voice', async () => {
    const { uncaptioned, heard, cards, session, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();
    session.dispatch({ type: 'voice-name', voice: 'v1', name: 'Daniel Hart' });
    await settle();

    heard('I cut taxes for every family.', 'v2');
    await settle();

    expect(cards()[1]?.whoIsThis?.voice).toBe('v2');
    expect(cards()[1]?.speaker).toBeUndefined();
    // The name given before is offered too (it's already on the page here).
    expect(cards()[1]?.whoIsThis?.names).toContain('Daniel Hart');
  });

  it('giving two voices the same name merges them', async () => {
    const { uncaptioned, heard, cards, session, venice, view } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();
    session.dispatch({ type: 'voice-name', voice: 'v1', name: 'Daniel Hart' });
    await settle();
    // Voice separation split one person into two voices.
    heard('I cut taxes for every family.', 'v2');
    await settle();

    session.dispatch({ type: 'voice-name', voice: 'v2', name: 'daniel hart' });
    await settle();
    heard('I balanced the budget twice.', 'v2');
    await settle();

    expect(cards().map((c) => [c.speaker?.name, label(c)])).toEqual([
      ['Daniel Hart', 'True'],
      ['Daniel Hart', 'True'],
      ['Daniel Hart', 'True'],
    ]);
    expect(cards()[2]?.whoIsThis).toBeUndefined();
    // One voice, as far as the viewer can tell.
    expect(view().lines.map((l) => voiceText(view(), l.voice))).toEqual(['Daniel Hart', 'Daniel Hart', 'Daniel Hart']);
    expect(view().voices.find((v) => v.id === 'v2')).toMatchObject({ sameAs: 'v1' });
    // Save session says who spoke each line.
    expect(exportSession(view(), NOON).transcript.map((l) => l.voice)).toEqual(['Daniel Hart', 'Daniel Hart', 'Daniel Hart']);
  });

  it('stays answerable after Stop: naming the voice re-checks its waiting claim, without listening again', async () => {
    const { uncaptioned, heard, cards, session, venice, view } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v1');
    await settle();
    session.dispatch({ type: 'stop', reason: 'viewer' });
    await settle();
    expect(cards()[0]?.whoIsThis).toMatchObject({ voice: 'v1' });

    session.dispatch({ type: 'voice-name', voice: 'v1', name: 'Daniel Hart' });
    await settle();
    expect(cards().map((c) => [c.speaker?.name, label(c)])).toEqual([['Daniel Hart', 'True']]);
    expect(view().status.state).toBe('stopped');
  });
});

describe('voice separation: captioned pages', () => {
  it('is off, and "Who said this?" offers "Tell voices apart for this video"', async () => {
    const { caption, cards, venice, view } = setup();
    debateBreakdown(venice);
    caption('I created forty thousand jobs.');
    await settle();

    expect(view().voiceSeparation).toBe(false);
    expect(cards()[0]?.whoSaid).toEqual({ names: ['Maria Lopez', 'Daniel Hart'], offerVoices: true });
  });

  it('stops offering "Tell voices apart for this video" after Stop, when nothing more is heard; the names stay', async () => {
    const { caption, cards, venice, session } = setup();
    debateBreakdown(venice);
    caption('I created forty thousand jobs.');
    await settle();

    session.dispatch({ type: 'stop', reason: 'viewer' });

    expect(cards()[0]?.whoSaid).toEqual({ names: ['Maria Lopez', 'Daniel Hart'] });
  });

  it('"Tell voices apart for this video" switches it on: captions get the voice that spoke at their time', async () => {
    const { caption, cards, venice, view, session, voices, clock } = setup();
    debateBreakdown(venice);
    caption('I created forty thousand jobs.');
    await settle();

    session.dispatch({ type: 'separate-voices' });
    expect(view().voiceSeparation).toBe(true);
    // The offer goes once it's on.
    expect(cards()[0]?.whoSaid).toEqual({ names: ['Maria Lopez', 'Daniel Hart'] });

    caption('I cut taxes for every family.'); // said at 4-8 s
    await settle();
    // Its audio hasn't been separated yet: the check waits for it.
    expect(cards()).toHaveLength(1);
    voices(0, 10, [{ start: 3.6, end: 9.5, voice: 'v4' }]);
    await settle();
    clock.advance(0);

    expect(view().lines.map((l) => voiceText(view(), l.voice))).toEqual([undefined, 'Voice A']);
    expect(cards()[1]?.whoIsThis?.voice).toBe('v4');
    session.dispatch({ type: 'voice-name', voice: 'v4', name: 'Maria Lopez' });
    await settle();
    expect(cards()[1]).toMatchObject({ speaker: { name: 'Maria Lopez', from: 'voice' } });
    expect(label(cards()[1])).toBe('True');
  });

  it('goes on without a voice if the audio is not separated in time', async () => {
    const { caption, cards, venice, session, clock } = setup();
    debateBreakdown(venice);
    session.dispatch({ type: 'separate-voices' });
    caption('I created forty thousand jobs.');
    await settle();
    expect(cards()).toHaveLength(0);

    clock.advance(15_000);
    await settle();
    expect(cards()[0]?.whoSaid?.names).toEqual(['Maria Lopez', 'Daniel Hart']);
    expect(cards()[0]?.whoIsThis).toBeUndefined();
  });

  it('is for this video only: a new page turns it off again and forgets the voices', async () => {
    const { session, view, uncaptioned, heard } = setup();
    session.dispatch({ type: 'separate-voices' });
    uncaptioned();
    heard('Good evening.', 'v1');
    session.dispatch({ type: 'page', tabId: TAB, page: { ...DEBATE, title: 'Another video', url: 'https://video.example/watch?v=other' } });

    expect(view().voices).toEqual([]);
    // Still on-device, so still on; but the viewer's choice is gone.
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: 0, end: 2, text: 'Captions again.' } });
    expect(view().voiceSeparation).toBe(false);
  });
});

describe('voice separation: what the worker reports', () => {
  it('follows voices the worker merged: a name given to either applies to both', async () => {
    const { uncaptioned, heard, cards, session, venice, voices, view } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'v2');
    await settle();
    session.dispatch({ type: 'voice-name', voice: 'v2', name: 'Maria Lopez' });

    voices(10, 20, [{ start: 10, end: 20, voice: 'v1' }], [{ voice: 'v2', into: 'v1' }]);
    heard('I cut taxes for every family.', 'v1');
    await settle();

    expect(cards()[1]).toMatchObject({ speaker: { name: 'Maria Lopez', from: 'voice' } });
    expect(cards()[1]?.whoIsThis).toBeUndefined();
    expect(view().lines.map((l) => voiceText(view(), l.voice))).toEqual(['Maria Lopez', 'Maria Lopez']);
  });

  it('counts the minutes of audio voice separation ran on, for the footer', () => {
    const { uncaptioned, voices, view, session } = setup();
    uncaptioned();
    voices(0, 12, [{ start: 0, end: 12, voice: 'v1' }]);
    voices(12, 30, []);
    // A stretch it couldn't run on doesn't count.
    session.dispatch({ type: 'voices', tabId: TAB, span: { start: 30, end: 90 }, turns: [], failed: true });
    expect(view().counters.voiceSeparationMinutes).toBeCloseTo(0.5);
  });

  it('never sends audio, voices or voice ids to the provider: only the name the viewer gave', async () => {
    const { uncaptioned, heard, cards, session, venice } = setup();
    debateBreakdown(venice);
    uncaptioned();
    heard('I created forty thousand jobs.', 'voice-id-v1');
    await settle();
    session.dispatch({ type: 'voice-name', voice: 'voice-id-v1', name: 'Sam Ortiz' });
    await settle();

    expect(cards()[0]?.speaker?.name).toBe('Sam Ortiz');
    for (const request of venice.requests) {
      expect(request.text).not.toContain('voice-id-v1');
      expect(request.text).not.toContain('Voice A');
    }
    expect(venice.requests.some((r) => r.text.includes('Sam Ortiz'))).toBe(true);
  });
});

describe('voice separation: where it cannot run', () => {
  it('is never on, and never offered', async () => {
    const clock = createFakeClock(NOON);
    const venice = createFakeVenice();
    happyProvider(venice);
    debateBreakdown(venice);
    const session = createSession({ clock, fetch: venice.fetch, newId: () => 'session-1' });
    session.dispatch({ type: 'start', tabId: TAB, page: DEBATE, settings: { mode: 'cloud', key: 'k' } });
    session.dispatch({ type: 'audio', tabId: TAB, flowing: true });
    clock.advance(10_000);
    session.dispatch({ type: 'on-device-segment', tabId: TAB, segment: { start: 0, end: 5, text: 'I created forty thousand jobs.' } });
    await settle();

    expect(session.snapshot().voiceSeparation).toBe(false);
    expect(session.snapshot().cards[0]?.whoSaid).toEqual({ names: ['Maria Lopez', 'Daniel Hart'] });
  });
});
