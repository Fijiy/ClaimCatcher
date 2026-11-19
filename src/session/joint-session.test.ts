// Session tests for #46, from the entrant's real run on "President Trump
// Addresses Joint Session of Congress, March 4, 2025" (testing/joint-session-2025.ts:
// the page as the extension read it, the uploader's captions, the on-device
// transcript's lines, and Gemini Nano's replies). Claims must be self-contained
// (who and when resolved) before they are searched or judged; the claim
// review keeps only the ones worth checking; one claim makes one card. Tests
// drive the session and assert on what the viewer sees and what left the
// device, never on prompt wording.

import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeLanguageModel, type FakeLanguageModel } from './testing/fake-language-model';
import { createFakeVenice, type FakeVenice } from './testing/fake-venice';
import { CAPTIONS, NANO_BREAKDOWNS, nanoReview, ON_DEVICE, PAGE_AS_READ, SAID_ON } from './testing/joint-session-2025';
import type { Card, PageContext, SessionSettings, TranscriptLine } from './types';
import { cardTags } from '../ui/card-text';

const TAB = 3;
/** The entrant watched it on 2026-10-26. */
const WATCHED = Date.UTC(2026, 9, 26, 18, 0, 0);
const VOICE = 'worker-voice-1';

const TRUE_VERDICT = {
  literal: '',
  implied: '',
  evidence: 'The figures match.',
  conclusion: 'The official figures match what was said.',
  label: 'True',
  missing: null,
  sources: [{ source: 1, stance: 'supports' }],
};

function setup(options: { mode?: SessionSettings['mode']; page?: PageContext; separatesVoices?: boolean } = {}) {
  const clock = createFakeClock(WATCHED);
  const venice = createFakeVenice();
  const nano = createFakeLanguageModel();
  const session = createSession({
    clock,
    fetch: venice.fetch,
    languageModel: nano.factory,
    separatesVoices: options.separatesVoices ?? false,
    newId: () => 'session-46',
  });
  session.dispatch({ type: 'start', tabId: TAB, page: options.page ?? PAGE_AS_READ, settings: { mode: options.mode ?? 'local', key: 'k' } });
  venice.onSearch((query) => [{ title: `BLS on ${query}`, url: `https://www.bls.gov/cpi/${encodeURIComponent(query)}`, content: 'What the CPI shows.' }]);
  nano.onVerdict(() => TRUE_VERDICT);
  venice.onVerdict(() => TRUE_VERDICT);
  const cards = () => session.snapshot().cards;
  const lines = () => session.snapshot().lines;
  const searched = () => venice.requests.filter((r) => r.url.endsWith('/augment/search')).map((r) => (r.body as { query: string }).query);
  return { clock, venice, nano, session, cards, lines, searched };
}

async function settle() {
  for (let i = 0; i < 200; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Gemini Nano breaks the on-device sentences down as it did on the entrant's run, and reviews claims as it did here. */
function nanoAsRecorded(nano: FakeLanguageModel) {
  nano.onBreakdown((user) => {
    const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '';
    return NANO_BREAKDOWNS[sentence] ?? { people_named: [], claims: [], skipped: [] };
  });
  nano.onReview((user) => nanoReview(/Claim to review:\n"(.*)"/.exec(user)?.[1] ?? ''));
}

/** The entrant's setup: no captions reach the session, so the on-device transcript (with voices) takes over. */
function hearOnDevice(session: ReturnType<typeof setup>['session'], clock: ReturnType<typeof setup>['clock'], segments = ON_DEVICE) {
  session.dispatch({ type: 'audio', tabId: TAB, flowing: true });
  clock.advance(10_000);
  for (const [start, end, text] of segments) {
    session.dispatch({ type: 'on-device-segment', tabId: TAB, segment: { start, end, text, voice: VOICE } });
    session.dispatch({ type: 'voices', tabId: TAB, span: { start, end }, turns: [{ start, end, voice: VOICE }] });
  }
  clock.advance(5_000);
}

const label = (card: Card | undefined) => (card?.check.state === 'done' ? card.check.verdict : undefined);
const said = (lines: TranscriptLine[], text: RegExp) => lines.find((l) => text.test(l.text));

describe('#46 on the joint session: who is speaking', () => {
  it('resolves "we" to the one person the page names, with voices told apart, and never asks "Who is this?"', async () => {
    const { clock, nano, session, cards } = setup({ separatesVoices: true });
    nanoAsRecorded(nano);
    hearOnDevice(session, clock);
    await settle();

    expect(session.snapshot().voiceSeparation).toBe(true);
    const inherited = cards().filter((c) => /we inherited/i.test(c.sentence));
    expect(inherited.length).toBeGreaterThan(0);
    for (const card of inherited) {
      expect(card.whoIsThis).toBeUndefined();
      expect(card.whoSaid).toBeUndefined();
      expect(card.speaker).toEqual({ name: 'Donald J. Trump', from: 'page' });
      expect(label(card)?.label).toBe('True');
    }
    expect(cards().some((c) => c.whoIsThis || c.whoSaid)).toBe(false);
  });

  it('offers only people as names, never pieces of a title or of YouTube\'s description box', async () => {
    // The same page, but its title names two people: "Who said this?" has to ask.
    const page = { ...PAGE_AS_READ, title: 'President Trump Meets With Speaker Johnson, March 4, 2025' };
    const { venice, session, cards } = setup({ mode: 'cloud', page });
    venice.onBreakdown(() => ({
      people_named: ['Trump', 'Johnson'],
      claims: [{ literal: 'The speaker inherited an inflation nightmare', implied: '', premise_of: null, depends_on_speaker: true, speaker_words: 'we', speaker: null, queries: { fact: 'inflation 2024', claim: 'inflation nightmare' } }],
      skipped: [],
    }));
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'youtube', start: 2266, end: 2274, text: 'As you know, we inherited an inflation nightmare.' } });
    await settle();

    expect(cards()[0]?.whoSaid?.names).toEqual(['Donald J. Trump', 'Johnson']);
  });
});

describe('#46 on the joint session: one card per claim', () => {
  it('gives a claim Nano repeats one card', async () => {
    const { clock, nano, session, cards } = setup({ separatesVoices: true });
    nanoAsRecorded(nano);
    hearOnDevice(session, clock);
    await settle();
    const before = cards().map((c) => c.id);

    // No two cards of one sentence show the same claim.
    const bySentence = new Map<string, string[]>();
    for (const card of cards()) bySentence.set(card.sentenceId, [...(bySentence.get(card.sentenceId) ?? []), card.claim?.literal ?? '']);
    for (const claims of bySentence.values()) expect(new Set(claims).size).toBe(claims.length);
    expect(cards().filter((c) => /forty eight years/.test(c.sentence))).toHaveLength(1);
    expect(before.length).toBeGreaterThan(0);
  });

  it('makes no new card when the viewer replays a stretch the on-device transcript already gave', async () => {
    const { clock, nano, session, cards, lines } = setup({ separatesVoices: true });
    nanoAsRecorded(nano);
    hearOnDevice(session, clock);
    await settle();
    const before = cards().map((c) => [c.id, c.claim?.literal]);

    // Replay from 37:44: the same audio is heard, and transcribed, again.
    hearOnDevice(session, clock, ON_DEVICE.slice(1, 5));
    await settle();
    expect(lines().filter((l) => /forty eight years/.test(l.text))).toHaveLength(2);
    expect(cards().map((c) => [c.id, c.claim?.literal])).toEqual(before);
  });

  it('quotes the line a premise comes from, never a skip reason', async () => {
    const { clock, nano, session, cards } = setup();
    nanoAsRecorded(nano);
    hearOnDevice(session, clock);
    await settle();

    expect(cards().length).toBeGreaterThan(0);
    for (const card of cards()) {
      for (const tag of cardTags(card)) expect(tag).not.toMatch(/no checkable fact/);
      const premise = card.claim?.premiseOf;
      if (premise) expect(card.sentence.toLowerCase()).toContain(premise.toLowerCase());
    }
  });
});

describe('#46 on the joint session: self-contained claims', () => {
  it('never searches or judges "Their policies…": the line says who can\'t be told', async () => {
    const { clock, nano, session, cards, lines, searched } = setup();
    nanoAsRecorded(nano);
    hearOnDevice(session, clock);
    await settle();

    expect(cards().some((c) => /their policies/i.test(c.claim?.literal ?? ''))).toBe(false);
    expect(searched().some((q) => /energy prices grocery costs/.test(q))).toBe(false);
    const line = said(lines(), /^Their policies/);
    expect(line?.skipped).toContainEqual(expect.objectContaining({ reason: 'not self-contained', unclear: 'Their' }));
  });

  it('keeps the speaker\'s own words on the card when the claim was rewritten to stand alone', async () => {
    const { venice, session, cards } = setup({ mode: 'cloud' });
    venice.onBreakdown(() => ({
      people_named: ['Trump'],
      claims: [
        {
          literal: "The Biden administration's policies drove up US energy prices and grocery costs",
          unresolved: null,
          implied: '',
          premise_of: null,
          depends_on_speaker: false,
          speaker_words: null,
          speaker: 'Trump',
          queries: { fact: 'US energy prices grocery costs 2021 2024', claim: 'Biden policies energy prices Trump' },
        },
      ],
      skipped: [],
    }));
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'youtube', start: 2276.12, end: 2281, text: 'Their policies drove up energy prices, pushed up grocery costs.' } });
    await settle();

    expect(cards()[0]?.claim?.literal).toBe("The Biden administration's policies drove up US energy prices and grocery costs");
    expect(cards()[0]?.sentence).toBe('Their policies drove up energy prices, pushed up grocery costs.');
    expect(cards()[0]?.speaker).toEqual({ name: 'Trump', from: 'page' });
  });
});

describe('#46 on the joint session: resolving "their" from what was said', () => {
  async function their(answer: string | null) {
    const s = setup();
    nanoAsRecorded(s.nano);
    s.nano.onReference(() => ({ refers_to: answer }));
    hearOnDevice(s.session, s.clock);
    await settle();
    return s;
  }

  it('names who "their" is when the earlier transcript does ("the last administration"), and checks it', async () => {
    const { cards, searched } = await their('the last administration');
    const card = cards().find((c) => /^Their policies/.test(c.sentence));
    expect(card?.claim?.literal).toBe("The last administration's policies drove up energy prices, pushed up grocery costs.");
    expect(label(card)?.label).toBe('True');
    expect(searched().length).toBeGreaterThan(0);
    // Nano gave the same claim again for the next sentence: still one card.
    expect(cards().filter((c) => /policies drove up energy prices/.test(c.claim?.literal ?? ''))).toHaveLength(1);
  });

  it('never takes a name the transcript and page don\'t say: the claim stays skipped, unsearched', async () => {
    const { cards, lines, searched } = await their('the Democrats');
    expect(cards().some((c) => /^Their policies/.test(c.sentence))).toBe(false);
    expect(said(lines(), /^Their policies/)?.skipped).toContainEqual(expect.objectContaining({ reason: 'not self-contained' }));
    expect(searched().some((q) => /Democrats|energy prices grocery costs/.test(q))).toBe(false);
  });
});

describe('#46 on the joint session: when it was said', () => {
  async function inflation() {
    const s = setup({ mode: 'cloud' });
    s.venice.onBreakdown(({ user }) => {
      const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '';
      return /48 years/.test(sentence)
        ? {
            people_named: ['Trump'],
            claims: [
              {
                literal: 'US inflation was the worst in 48 years',
                unresolved: null,
                implied: 'Inflation under the last administration was historically bad',
                premise_of: null,
                depends_on_speaker: false,
                speaker_words: null,
                speaker: 'Trump',
                queries: { fact: 'recent US inflation record', claim: 'worst inflation in 48 years Trump' },
              },
            ],
            skipped: [{ text: "they're not sure", reason: 'no checkable fact' }],
          }
        : { people_named: ['Trump'], claims: [], skipped: [] };
    });
    for (const [start, end, text] of CAPTIONS.filter(([start]) => start >= 2257 && start < 2296)) {
      s.session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'youtube', start, end, text } });
    }
    s.clock.advance(5_000);
    await settle();
    return s;
  }

  it('dates the claim by the day it was said: the title\'s March 4, not the stream\'s UTC start', async () => {
    const { cards, venice } = await inflation();
    const card = cards().find((c) => /48 years/.test(c.sentence));
    expect(label(card)).toMatchObject({ judgedAsOf: SAID_ON, judgedAsOfBasis: 'recording' });
    const breakdowns = venice.requests.filter((r) => r.text.includes('claim_breakdown'));
    expect(breakdowns.length).toBeGreaterThan(0);
    for (const request of breakdowns) expect(request.text).toContain(SAID_ON);
  });

  it('searches with years, counted from that day ("in 48 years" is since 1977), never "recent"', async () => {
    const { searched } = await inflation();
    expect(searched().length).toBeGreaterThan(0);
    for (const query of searched()) {
      expect(query).toMatch(/\b1977\b/);
      expect(query).toMatch(/\b2025\b/);
      expect(query).not.toMatch(/recent/i);
    }
  });

  it('tells the verdict step the day the claim was said', async () => {
    const { venice } = await inflation();
    const verdicts = venice.requests.filter((r) => r.text.includes('"verdict"') || r.text.includes('Claim to check'));
    expect(verdicts.length).toBeGreaterThan(0);
    for (const request of verdicts) expect(request.text).toContain(SAID_ON);
  });
});

describe('#46 claim review: only claims worth checking become cards', () => {
  const PAGE: PageContext = { title: 'Lopez vs. Hart: immigration debate', url: 'https://video.example/watch?v=ice', channel: 'Ohio Public Media' };
  /** Breakdown gives each sentence's words back as its claim; the review answers as Gemini Nano did for the entrant's examples. */
  function reviewed(venice: FakeVenice) {
    venice.onBreakdown(({ user }) => {
      const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '';
      const unresolved = /^They\b/.exec(sentence)?.[0] ?? null;
      return { people_named: ['Lopez', 'Hart'], claims: [{ literal: sentence.replace(/\.$/, ''), unresolved, implied: '', premise_of: null, depends_on_speaker: false, speaker_words: null, speaker: null, queries: { fact: sentence, claim: sentence } }], skipped: [] };
    });
    venice.onReview(({ user }) => {
      const claim = /Claim to review:\n"(.*)"/.exec(user)?.[1] ?? '';
      if (/terrorizing/.test(claim)) return { reason: 'A characterisation, not a fact.', kind: 'opinion', unclear: null };
      if (/has an immigration enforcement strategy/.test(claim)) return { reason: 'Every administration has one.', kind: 'trivially true', unclear: null };
      if (/made a correction/.test(claim)) return { reason: 'Which correction is not said.', kind: 'too vague', unclear: null };
      return { reason: 'A figure a source can settle.', kind: 'checkable fact', unclear: null };
    });
  }
  const SAID = [
    'ICE is about terrorizing our streets.',
    'President Trump has an immigration enforcement strategy.',
    'They killed two people.',
    'The administration made a correction.',
    'ICE deported 270,000 people in 2024.',
  ];

  async function run(settings: { forced?: string } = {}) {
    const s = setup({ mode: 'cloud', page: PAGE });
    reviewed(s.venice);
    SAID.forEach((text, i) => s.session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: i * 5, end: i * 5 + 4, text } }));
    s.clock.advance(5_000);
    await settle();
    if (settings.forced) {
      const line = s.lines().find((l) => l.text === settings.forced)!;
      s.session.dispatch({ type: 'force-check', lineId: line.id });
      await settle();
    }
    return s;
  }
  const reviews = (venice: FakeVenice) => venice.requests.filter((r) => r.text.includes('claim_review'));

  it('makes a card only of the specific, self-contained fact', async () => {
    const { cards } = await run();
    expect(cards().map((c) => c.claim?.literal)).toEqual(['ICE deported 270,000 people in 2024']);
  });

  it('shows why each other line was skipped, in Full transcript', async () => {
    const { lines } = await run();
    const why = (text: string) => lines().find((l) => l.text === text)?.skipped?.map((p) => [p.reason, p.unclear ?? null]);
    expect(why('ICE is about terrorizing our streets.')).toEqual([['opinion', null]]);
    expect(why('President Trump has an immigration enforcement strategy.')).toEqual([['not worth checking', null]]);
    expect(why('They killed two people.')).toEqual([['not self-contained', 'They']]);
    expect(why('The administration made a correction.')).toEqual([['too vague to check', null]]);
  });

  it('never searches a claim whose "they" no one named, nor reviews it', async () => {
    const { venice, searched } = await run();
    expect(searched().some((q) => /killed/.test(q))).toBe(false);
    expect(reviews(venice).some((r) => /killed/.test(r.text))).toBe(false);
  });

  it('reviews each claim with its own prompt, and counts those calls in the footer', async () => {
    const { venice, session } = await run();
    // Four claims reviewed (the unresolved one never is): five breakdowns, one try at "They", four reviews, one verdict.
    expect(reviews(venice)).toHaveLength(4);
    expect(session.snapshot().counters.cloudCalls).toBe(11);
  });

  it('still checks a line the review dropped when the viewer asks ("Check this"), without reviewing it again', async () => {
    const { venice, cards } = await run({ forced: 'ICE is about terrorizing our streets.' });
    const forced = cards().filter((c) => c.forced);
    expect(forced.map((c) => [c.sentence, label(c)?.label])).toEqual([['ICE is about terrorizing our streets.', 'True']]);
    expect(reviews(venice)).toHaveLength(4);
  });

  it('checks a forced line whose "they" no one named only as far as saying so: no search', async () => {
    const { cards, searched } = await run({ forced: 'They killed two people.' });
    const forced = cards().find((c) => c.forced);
    expect(label(forced)).toMatchObject({ label: 'Unverified', sources: [] });
    expect(label(forced)?.conclusion).toMatch(/They/);
    expect(searched().some((q) => /killed/.test(q))).toBe(false);
  });
});
