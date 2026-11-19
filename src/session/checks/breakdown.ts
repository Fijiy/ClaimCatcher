// Stage 1, claim breakdown: one sentence (with ~30 s of context, the page's
// title and channel, the date it was said, and any known speaker) in; zero or
// more claims and the skipped parts out. Each claim is rewritten to stand
// alone (decontextualised): who and what its words refer to are named, and
// time words become dates, counted from the day it was said; words that
// can't be resolved are kept and reported (`unresolved`), never guessed.
// Every claim carries two search queries for stage 2, and says whether it
// depends on who is speaking and, if the page or a given speaker settles
// that, who. The speaker gate (speaker.ts) decides what to trust: breakdown
// is never asked to guess the speaker from what was said.

import type { SkipReason, SkippedPart } from '../types';
import { ProviderError, type JsonModel, type JsonSchema } from './provider';

export interface BreakdownInput {
  sentence: string;
  /** About 30 s of what was said before the sentence. */
  context: string;
  title: string;
  channel?: string;
  /** The video's description. Only an on-device model (`JsonModel.onDevice`) is shown it. */
  description?: string;
  /** Who is speaking, when the viewer has said (or a voice the viewer named), or the one person the page names. */
  speaker?: string;
  /** Where `speaker` comes from: the viewer (directly or through a voice they named), or the page. Defaults to the viewer. */
  speakerFrom?: 'viewer' | 'page';
  /**
   * The day it was said, YYYY-MM-DD: the recording date, or today when the
   * page gives none (`known: false`), as for a live stream.
   */
  saidOn?: { date: string; known: boolean };
  /** Re-checking one claim from the sentence (after "Who said this?"): give just this claim again. */
  only?: string;
  /** The viewer asked for this check: breakdown must give at least one claim. */
  forced?: boolean;
}

export interface BrokenDownClaim {
  /** The claim as a stand-alone statement: references and time words resolved. */
  literal: string;
  /**
   * Words in `literal` that still refer to someone or something no one named
   * ("they", "that correction"), as breakdown quoted them; null if none. The
   * speaker's own words ("I", "we") are never here: the speaker gate handles them.
   */
  unresolved: string | null;
  implied: string;
  premiseOf: string | null;
  speaker: ClaimSpeaker;
  queries: ClaimQueries;
}

/** What breakdown says about who made a claim. */
export interface ClaimSpeaker {
  /** The claim's truth depends on who said it ("I've created more jobs…"). */
  depends: boolean;
  /** The words that refer to the speaker, as said ("I", "my administration"). */
  words: string | null;
  /** Who that is, if the given speaker or the title and channel settle it. Checked by speaker.ts before it's trusted. */
  name: string | null;
}

/** The two searches run for a claim. */
export interface ClaimQueries {
  /** A neutral query for the underlying fact, no speaker and no "fact check" words. */
  fact: string;
  /** The claim's own key words, plus the speaker's surname when known. */
  claim: string;
}

export interface Breakdown {
  claims: BrokenDownClaim[];
  skipped: SkippedPart[];
  /** Everyone the title and channel (and, on the device, the description) name. */
  peopleNamed: string[];
}

const SKIP_REASONS: readonly SkipReason[] = [
  'opinion',
  'value judgement',
  'hyperbole',
  'rhetorical question',
  'prediction',
  'promise',
  'no checkable fact',
];

const SYSTEM = `You pull checkable claims out of one sentence from a live political video, for a nonpartisan fact-checker.

A claim is a single checkable statement of fact: the checkable part of a sentence. One sentence can hold several claims; give each its own entry, once, so a true part never hides a false one. Never give the same claim twice.

Skip anything with no checkable fact: opinion, value judgement, hyperbole, rhetorical question, prediction, promise. When a skipped part rests on a checkable fact, give that fact as a claim and set "premise_of" to the skipped part's words, quoted exactly from the sentence. Example: "Because taxes are the highest in history, I'll cut them" gives the claim "Taxes are the highest in history" with premise_of "I'll cut them", and skips "I'll cut them" as a promise. A claim that is no premise has premise_of null.

Take claims from the sentence to check only. Each claim must stand alone: someone who never saw the video must be able to tell who and what it is about, and when.
- Who and what: replace words like "they", "their policies", "he", "this bill" or "the last administration" with the people, groups or things they refer to, named from the sentence, the earlier transcript, the video's details or the date it was said (said by President Obama in 2010, "the last administration" is "the Bush administration"). When those don't name it, keep the words as said and quote them in "unresolved". Never name anyone from their views, party or positions, or from what they would be likely to say.
- When: rewrite time words as years or dates counted from the day it was said: "now", "last year", "this month", "since I took office", "in 50 years". Example: said on 2019-09-06, "unemployment is the lowest in 50 years" becomes "US unemployment in 2019 was the lowest since 1969".
- Leave out filler such as "as you know" or "believe it or not".

Who is speaking: some claims depend on who says them ("I've created more jobs than anyone", "my administration cut taxes", "we inherited a mess"). For such a claim set "depends_on_speaker" to true and "speaker_words" to the words that refer to the speaker, quoted exactly (for example "I" or "my administration"); otherwise false and null. Set "speaker" to the speaker's name only when the speaker is given below, or when the video's details show it is one named person speaking (a speech, remarks or an address by them); otherwise null, and write the speaker as "the speaker" in "literal". When the speaker is given, write their name in "literal" ("we" said by a president or governor is their administration). Never work out who is speaking from what is said, from the earlier transcript, or from anyone's known views or positions: in a debate, interview, hearing or panel, or when the video's details name more than one person, "speaker" is null unless it is given.

For each claim:
- "literal": the stand-alone claim, as one sentence.
- "unresolved": the words in "literal" that still refer to someone or something not named, quoted exactly, or null. Words for the speaker ("I", "we", "my administration") never go here.
- "implied": what an ordinary listener is meant to conclude from it, beyond its literal words.
- "premise_of": the quoted skipped words this claim is the premise of, or null.
- "depends_on_speaker", "speaker_words" and "speaker": as above.
- "queries.fact": a neutral web search for the underlying fact or figure, with its years. No speaker name, and none of the words "fact check", "true", "false", "claim", "debunk", "recent" or "latest".
- "queries.claim": a web search with the claim's own key words and years, plus the speaker's surname if the video's title or channel names the speaker.

For each skipped part: "text" (its words, quoted from the sentence) and "reason", one of: ${SKIP_REASONS.map((r) => `"${r}"`).join(', ')}.

"people_named": every person the video's title and channel name, as written there (an empty list if none).

A sentence can have no claims and no skipped parts only if it is empty of meaning (for example "Thank you.").
Reply with JSON only.`;

/** The example claims the prompt quotes: a small model sometimes gives one back as a claim (tidy.ts drops those). */
export const PROMPT_EXAMPLES: readonly string[] = [...SYSTEM.matchAll(/"([^"]{12,})"/g)].map((m) => m[1]!);

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['people_named', 'claims', 'skipped'],
  properties: {
    people_named: { type: 'array', items: { type: 'string' } },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['literal', 'unresolved', 'implied', 'premise_of', 'depends_on_speaker', 'speaker_words', 'speaker', 'queries'],
        properties: {
          literal: { type: 'string' },
          unresolved: { type: ['string', 'null'] },
          implied: { type: 'string' },
          premise_of: { type: ['string', 'null'] },
          depends_on_speaker: { type: 'boolean' },
          speaker_words: { type: ['string', 'null'] },
          speaker: { type: ['string', 'null'] },
          queries: {
            type: 'object',
            additionalProperties: false,
            required: ['fact', 'claim'],
            properties: { fact: { type: 'string' }, claim: { type: 'string' } },
          },
        },
      },
    },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'reason'],
        properties: { text: { type: 'string' }, reason: { type: 'string', enum: SKIP_REASONS } },
      },
    },
  },
};

/**
 * The user message. The description goes in only for an on-device model: in
 * cloud mode the provider gets the title and channel, never the description.
 */
export function breakdownPrompt(input: BreakdownInput, onDevice = false): string {
  const description = onDevice ? input.description?.trim() : undefined;
  return [
    `Video: "${input.title}"${input.channel ? `, channel "${input.channel}"` : ''}`,
    ...(description ? ['', 'Video description:', `"${description}"`] : []),
    ...(input.saidOn
      ? ['', input.saidOn.known ? `Said on: ${input.saidOn.date}` : `Said on: ${input.saidOn.date} (today: the page gives no date, so it is taken as live)`]
      : []),
    ...(input.speaker
      ? [
          '',
          input.speakerFrom === 'page'
            ? `Speaker (the one person the video's title and channel name): "${input.speaker}". Use this name for the speaker, and set "speaker" to it.`
            : `Speaker (named by the viewer): "${input.speaker}". Use this name for the speaker, and set "speaker" to it.`,
        ]
      : []),
    '',
    'What was said in the ~30 seconds before:',
    `"${input.context || '(nothing yet)'}"`,
    '',
    ...(input.forced
      ? ['The viewer asked to check this sentence, so give at least one claim: if it holds no checkable fact, give what it asserts as the claim.', '']
      : []),
    ...(input.only ? [`Give only this claim from the sentence, as one claim: "${input.only}"`, ''] : []),
    'Sentence to check:',
    `"${input.sentence}"`,
  ].join('\n');
}

export async function breakDown(model: JsonModel, input: BreakdownInput): Promise<Breakdown> {
  const user = breakdownPrompt(input, model.onDevice === true);
  const reply = await model.generate({ name: 'claim_breakdown', system: SYSTEM, user, schema: SCHEMA });
  return parseBreakdown(reply);
}

function parseBreakdown(reply: unknown): Breakdown {
  const bad = () => new ProviderError('failed', 'claim breakdown reply does not match its schema');
  if (!isObject(reply) || !Array.isArray(reply.claims) || !Array.isArray(reply.skipped)) throw bad();
  const claims = reply.claims.flatMap((c): BrokenDownClaim[] => {
    if (!isObject(c) || !isObject(c.queries)) throw bad();
    const literal = text(c.literal);
    if (!literal) return [];
    return [
      {
        literal,
        unresolved: text(c.unresolved) || null,
        implied: text(c.implied),
        premiseOf: text(c.premise_of) || null,
        speaker: {
          depends: c.depends_on_speaker === true,
          words: text(c.speaker_words) || null,
          name: text(c.speaker) || null,
        },
        queries: { fact: text(c.queries.fact), claim: text(c.queries.claim) },
      },
    ];
  });
  const skipped = reply.skipped.flatMap((s): SkippedPart[] => {
    if (!isObject(s)) throw bad();
    const words = text(s.text);
    if (!words) return [];
    const reason = SKIP_REASONS.find((r) => r === s.reason) ?? 'no checkable fact';
    return [{ text: words, reason }];
  });
  const peopleNamed = Array.isArray(reply.people_named) ? reply.people_named.map(text).filter(Boolean) : [];
  return { claims, skipped, peopleNamed };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
