// Session tests for who said it (spec stories 49-52): claims that depend on
// the speaker are checked against the right person, and never pinned on a
// guess. The provider is a fake `fetch` (testing/fake-venice.ts); tests assert
// only on what the viewer sees (cards) and on what left the device.

import { describe, expect, it } from 'vitest';
import { exportSession } from './export';
import { createSession } from './session';
import { createFakeClock } from './testing/fake-clock';
import { createFakeVenice, type Asked, type FakeVenice } from './testing/fake-venice';
import type { Card, PageContext, SessionEvent } from './types';

const TAB = 7;
const NOON = Date.UTC(2026, 9, 26, 12, 0, 0);

function setup(page: Partial<PageContext> = {}) {
  const clock = createFakeClock(NOON);
  const venice = createFakeVenice();
  const session = createSession({ clock, fetch: venice.fetch, newId: () => 'session-1' });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.dispatch({
    type: 'start',
    tabId: TAB,
    page: { title: 'Floor speech', url: 'https://video.example/watch?v=abc123', ...page },
    settings: { mode: 'cloud', key: 'k' },
  });
  let cueAt = 0;
  const say = (text: string) => {
    session.dispatch({ type: 'caption', tabId: TAB, segment: { reader: 'track', start: cueAt, end: cueAt + 4, text } });
    cueAt += 4;
  };
  const cards = () => session.snapshot().cards;
  return { venice, session, events, say, cards };
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const JOBS = "I've created more jobs than any of my predecessors.";

/** A claim as claim breakdown answers it, with what it says about the speaker. */
function claim(
  literal: string,
  speaker: { depends?: boolean; words?: string | null; name?: string | null } = {},
  claimQuery = literal,
) {
  return {
    literal,
    implied: `${literal} (implied)`,
    premise_of: null,
    depends_on_speaker: speaker.depends ?? false,
    speaker_words: speaker.words ?? null,
    speaker: speaker.name ?? null,
    queries: { fact: `${literal} figures`, claim: claimQuery },
  };
}

/** Finds two sources per query and calls every claim True. */
function happyProvider(venice: FakeVenice) {
  venice.onSearch((query) => [
    { title: `BLS on ${query}`, url: 'https://www.bls.gov/jobs', content: 'Payrolls grew.' },
    { title: `AP on ${query}`, url: 'https://apnews.com/jobs', content: 'Economists agree.' },
  ]);
  venice.onVerdict(() => ({
    literal: '',
    implied: '',
    evidence: '',
    conclusion: 'The payroll figures back it.',
    label: 'True',
    missing: null,
    sources: [{ source: 1, stance: 'supports' }],
  }));
}

/** The user message of every chat request with this schema name. */
function asked(venice: FakeVenice, name: 'claim_breakdown' | 'verdict'): string[] {
  return venice.requests
    .map((r) => r.body as { messages?: Array<{ role: string; content: string }>; response_format?: { json_schema?: { name?: string } } })
    .filter((b) => b?.response_format?.json_schema?.name === name)
    .map((b) => b.messages!.find((m) => m.role === 'user')!.content);
}

const searchQueries = (venice: FakeVenice) =>
  venice.requests.filter((r) => r.url.endsWith('/augment/search')).map((r) => (r.body as { query: string }).query);

const label = (card: Card | undefined) => (card?.check.state === 'done' ? card.check.verdict.label : 'checking');

describe('who said it: page context', () => {
  it('resolves "I" from the title and channel of a single-speaker video, and shows the speaker', async () => {
    const { venice, say, cards } = setup({ title: 'Governor Maria Lopez: State of the State address', channel: 'Office of the Governor' });
    happyProvider(venice);
    venice.onBreakdown(() => ({
      people_named: ['Maria Lopez'],
      claims: [claim('Maria Lopez has created more jobs than any of her predecessors', { depends: true, words: 'I', name: 'Maria Lopez' }, 'Lopez more jobs than any predecessor')],
      skipped: [],
    }));

    say(JOBS);
    await settle();

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({ speaker: { name: 'Maria Lopez', from: 'page' } });
    expect(cards()[0]?.whoSaid).toBeUndefined();
    expect(label(cards()[0])).toBe('True');
    // Breakdown was given the title and channel to resolve "I" with.
    expect(asked(venice, 'claim_breakdown')[0]).toContain('Governor Maria Lopez: State of the State address');
    expect(asked(venice, 'claim_breakdown')[0]).toContain('Office of the Governor');
    expect(searchQueries(venice)).toContain('Lopez more jobs than any predecessor');
  });
});

describe('who said it: "Who said this?"', () => {
  const DEBATE = {
    title: 'Lopez vs. Hart: the second governor debate',
    channel: 'Ohio Public Media',
    description: 'Democratic nominee Maria Lopez and Republican nominee Daniel Hart meet in Columbus. Moderated by Ann Kerr.',
  };

  /** Breakdown can't tell who "I" is (a debate); once the viewer names someone, it uses that name. */
  function debateBreakdown(venice: FakeVenice) {
    venice.onBreakdown(({ user }: Asked) => {
      const named = /Speaker \(named by the viewer\): "(.*?)"/.exec(user)?.[1];
      const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '';
      if (!named) {
        const said = /cut taxes/.test(sentence) ? 'The speaker cut taxes for every family in this state' : 'The speaker has created more jobs than any of their predecessors';
        return { people_named: ['Lopez', 'Hart'], claims: [claim(said, { depends: true, words: 'I' })], skipped: [] };
      }
      const surname = named.split(' ').at(-1);
      return {
        people_named: ['Lopez', 'Hart'],
        claims: [claim(`${named} has created more jobs than any of their predecessors`, { depends: true, words: 'I', name: named }, `${surname} more jobs than predecessors`)],
        skipped: [],
      };
    });
  }

  it('asks, with the names on the page as answers, and is Unverified until answered, without searching or judging', async () => {
    const { venice, say, cards } = setup(DEBATE);
    happyProvider(venice);
    debateBreakdown(venice);

    say(JOBS);
    await settle();

    expect(cards()).toHaveLength(1);
    const card = cards()[0]!;
    expect(card.whoSaid).toEqual({ names: ['Maria Lopez', 'Daniel Hart', 'Ann Kerr'] });
    expect(card.speaker).toBeUndefined();
    expect(card.check).toMatchObject({
      state: 'done',
      verdict: { label: 'Unverified', conclusion: 'Can’t tell who “I” refers to, so this wasn’t checked.', sources: [] },
    });
    expect(searchQueries(venice)).toEqual([]);
    expect(asked(venice, 'verdict')).toEqual([]);
  });

  it('re-checks the claim with the speaker the viewer names, and then shows that speaker', async () => {
    const { venice, say, cards, session, events } = setup(DEBATE);
    happyProvider(venice);
    debateBreakdown(venice);
    say(JOBS);
    await settle();
    const cardId = cards()[0]!.id;
    const before = events.length;

    session.dispatch({ type: 'speaker-answer', cardId, name: 'Daniel Hart' });
    await settle();

    const card = cards()[0]!;
    expect(card.id).toBe(cardId);
    expect(card.speaker).toEqual({ name: 'Daniel Hart', from: 'viewer' });
    expect(card.whoSaid).toBeUndefined();
    expect(card.claim?.literal).toBe('Daniel Hart has created more jobs than any of their predecessors');
    expect(label(card)).toBe('True');
    // It went through the stages again, from pulling out the claim.
    const stages = events.slice(before).flatMap((e) => (e.type === 'card' ? [e.card.check.state === 'checking' ? e.card.check.stage : e.card.check.verdict.label] : []));
    expect(stages).toEqual(['breakdown', 'search', 'weighing', 'True']);
    // The named speaker went with the re-check, and into the search.
    expect(asked(venice, 'claim_breakdown').at(-1)).toContain('Daniel Hart');
    expect(searchQueries(venice)).toContain('Hart more jobs than predecessors');
    expect(asked(venice, 'verdict')).toHaveLength(1);
    expect(asked(venice, 'verdict')[0]).toContain('Daniel Hart');
    // Save session keeps who said it.
    expect(exportSession(session.snapshot(), NOON).claims[0]).toMatchObject({ speaker: 'Daniel Hart' });
  });

  it('can be answered later, offers names given before, and is answered only once', async () => {
    const { venice, say, cards, session } = setup(DEBATE);
    happyProvider(venice);
    debateBreakdown(venice);
    say(JOBS);
    await settle();
    session.dispatch({ type: 'speaker-answer', cardId: cards()[0]!.id, name: '  Sam  Ortiz ' });
    await settle();
    say('I cut taxes for every family in this state.');
    await settle();

    expect(cards()[0]?.speaker).toEqual({ name: 'Sam Ortiz', from: 'viewer' });
    // A new claim asks again (no guessing that it's the same person), offering the name given before.
    expect(cards()[1]?.whoSaid).toEqual({ names: ['Maria Lopez', 'Daniel Hart', 'Ann Kerr', 'Sam Ortiz'] });

    const chats = venice.requests.length;
    session.dispatch({ type: 'speaker-answer', cardId: cards()[0]!.id, name: 'Maria Lopez' });
    await settle();
    expect(venice.requests.length).toBe(chats);
    expect(cards()[0]?.speaker).toEqual({ name: 'Sam Ortiz', from: 'viewer' });
  });

  it('stays answerable on the Unverified card after Stop: answering re-checks it without listening again', async () => {
    const { venice, say, cards, session } = setup(DEBATE);
    happyProvider(venice);
    debateBreakdown(venice);
    say(JOBS);
    await settle();
    session.dispatch({ type: 'stop', reason: 'viewer' });
    await settle();
    expect(cards()[0]?.whoSaid?.names).toEqual(['Maria Lopez', 'Daniel Hart', 'Ann Kerr']);

    session.dispatch({ type: 'speaker-answer', cardId: cards()[0]!.id, name: 'Maria Lopez' });
    await settle();

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({ speaker: { name: 'Maria Lopez', from: 'viewer' } });
    expect(label(cards()[0])).toBe('True');
    expect(asked(venice, 'verdict')).toHaveLength(1);
    expect(session.snapshot().status.state).toBe('stopped');
    // Still stopped: new captions are not heard.
    say('Ohio added forty thousand jobs last year.');
    await settle();
    expect(session.snapshot().lines).toHaveLength(1);
  });

  it('closes the prompt after Stop once the viewer forgets the key or switches mode, and sends nothing more', async () => {
    const { venice, say, cards, session } = setup(DEBATE);
    happyProvider(venice);
    debateBreakdown(venice);
    say(JOBS);
    await settle();
    session.dispatch({ type: 'stop', reason: 'viewer' });
    const sent = venice.requests.length;

    session.dispatch({ type: 'settings-withdrawn' });
    session.dispatch({ type: 'speaker-answer', cardId: cards()[0]!.id, name: 'Maria Lopez' });
    await settle();

    expect(cards()[0]?.whoSaid).toBeUndefined();
    expect(label(cards()[0])).toBe('Unverified');
    expect(venice.requests.length).toBe(sent);
  });

  it('re-checks every claim of the sentence still waiting for its speaker, and leaves the others alone', async () => {
    const { venice, say, cards, session } = setup(DEBATE);
    happyProvider(venice);
    venice.onBreakdown(({ user }) => {
      const named = /Speaker \(named by the viewer\): "(.*?)"/.exec(user)?.[1];
      if (named) return { people_named: [], claims: [claim(`${named} ${/Give only this claim from the sentence, as one claim: "The speaker (.*)"/.exec(user)![1]}`, { depends: true, name: named })], skipped: [] };
      return {
        people_named: ['Lopez', 'Hart'],
        claims: [
          claim('The speaker cut taxes', { depends: true, words: 'I' }),
          claim('Ohio added 40,000 jobs last year'),
          claim('The speaker balanced the budget', { depends: true, words: 'I' }),
        ],
        skipped: [],
      };
    });
    say('I cut taxes, Ohio added forty thousand jobs last year, and I balanced the budget.');
    await settle();
    expect(cards().map((c) => !!c.whoSaid)).toEqual([true, false, true]);
    const verdictsBefore = asked(venice, 'verdict').length;

    session.dispatch({ type: 'speaker-answer', cardId: cards()[2]!.id, name: 'Maria Lopez' });
    await settle();

    expect(cards().map((c) => [c.claim?.literal, c.speaker?.name, label(c)])).toEqual([
      ['Maria Lopez cut taxes', 'Maria Lopez', 'True'],
      ['Ohio added 40,000 jobs last year', undefined, 'True'],
      ['Maria Lopez balanced the budget', 'Maria Lopez', 'True'],
    ]);
    expect(asked(venice, 'verdict').length).toBe(verdictsBefore + 2);
  });
});

describe('who said it: never a guess', () => {
  const asks = (card: Card | undefined) => [!!card?.whoSaid, card?.speaker, label(card)];

  it.each([
    [
      'the title names two people (a debate)',
      { title: 'Lopez vs. Hart: the second governor debate', channel: 'Ohio Public Media' },
      'Maria Lopez',
      'Thank you both. Governor, your record on jobs.',
    ],
    [
      'the title names someone else as well, even if breakdown leaves them out',
      { title: 'Senator Ann Kerr questions Fed Chair Tom Reyes', channel: 'C-SPAN' },
      'Ann Kerr',
      '',
    ],
    [
      'only what was said names them',
      { title: 'Floor speech', channel: 'House of Representatives' },
      'Ann Kerr',
      'The chair recognizes the gentlewoman from Ohio, Ms. Kerr.',
    ],
    [
      'only the description names them, and the provider was never shown it',
      { title: 'Remarks on jobs', channel: 'Ohio Public Media', description: 'Governor Maria Lopez speaks in Columbus.' },
      'Maria Lopez',
      '',
    ],
  ])('asks "Who said this?" when %s, whoever breakdown names', async (_case, page, guessed, before) => {
    const { venice, say, cards } = setup(page);
    happyProvider(venice);
    venice.onBreakdown(({ user }) =>
      user.includes(JOBS)
        ? {
            people_named: [guessed],
            claims: [claim(`${guessed} has created more jobs than any of their predecessors`, { depends: true, words: 'I', name: guessed })],
            skipped: [],
          }
        : { people_named: [], claims: [], skipped: [] },
    );

    if (before) say(before);
    say(JOBS);
    await settle();

    expect(asks(cards()[0])).toEqual([true, undefined, 'Unverified']);
    expect(asked(venice, 'verdict')).toEqual([]);
    expect(searchQueries(venice)).toEqual([]);
  });

  it('shows no speaker for a claim breakdown pins on someone the page does not name', async () => {
    const { venice, say, cards } = setup({ title: 'Floor speech' });
    happyProvider(venice);
    venice.onBreakdown(() => ({
      people_named: [],
      claims: [claim('Ohio added 40,000 jobs last year', { depends: false, name: 'Ann Kerr' })],
      skipped: [],
    }));

    say('Ohio added forty thousand jobs last year.');
    await settle();

    expect(asks(cards()[0])).toEqual([false, undefined, 'True']);
    expect(asked(venice, 'verdict')[0]).not.toContain('Ann Kerr');
  });

  it('never sends the description, or the names found only there, to the provider', async () => {
    const { venice, say, cards, session } = setup({
      title: 'Lopez vs. Hart: the second governor debate',
      channel: 'Ohio Public Media',
      description: 'Democratic nominee Maria Lopez and Republican nominee Daniel Hart meet in Columbus. Moderated by Ann Kerr.',
    });
    happyProvider(venice);
    venice.onBreakdown(() => ({
      people_named: ['Lopez', 'Hart'],
      claims: [claim('The speaker has created more jobs than any of their predecessors', { depends: true, words: 'I' })],
      skipped: [],
    }));
    say(JOBS);
    await settle();
    expect(cards()[0]?.whoSaid?.names).toContain('Ann Kerr');
    session.dispatch({ type: 'speaker-answer', cardId: cards()[0]!.id, name: 'Maria Lopez' });
    await settle();

    expect(venice.requests.length).toBeGreaterThan(0);
    for (const request of venice.requests) {
      expect(request.text).not.toContain('Columbus');
      expect(request.text).not.toContain('Ann Kerr');
      expect(request.text).not.toContain('Daniel Hart');
    }
    // The title and channel did go, and the name the viewer chose.
    expect(asked(venice, 'claim_breakdown')[0]).toContain('Lopez vs. Hart: the second governor debate');
    expect(asked(venice, 'claim_breakdown').at(-1)).toContain('Maria Lopez');
  });
});
