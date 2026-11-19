// Stage 1c, the claim review: after claim breakdown and before any search,
// one fresh prompt per stand-alone claim decides whether it is worth checking.
// A claim is kept only if it is a specific, verifiable statement of fact (not
// an opinion, value judgement, hyperbole, prediction or promise), it is
// self-contained (who and what it is about are named), and a viewer could be
// misled by it (not vague, not trivially true). The model gives its reason
// and the kind of statement; the keep/drop decision is code, from those.
//
// Forced checks never come here: the viewer asked for them.

import type { SkipReason } from '../types';
import { ProviderError, type JsonModel, type JsonSchema } from './provider';
import { refersElsewhere } from './tidy';

export interface ReviewInput {
  /** The stand-alone claim, as breakdown wrote it. */
  claim: string;
  /** The day it was said, YYYY-MM-DD, when known. */
  saidOn?: string;
  /** Who said it, when the page or the viewer settled it. */
  speaker?: string;
}

/** What the review decided about one claim. */
export type Review =
  | { keep: true }
  /**
   * Dropped, with the skipped-statement reason the transcript shows, and the
   * words that left it unclear (not self-contained). `fact`: apart from those
   * words, a checkable fact (so naming who they are would keep it).
   */
  | { keep: false; reason: SkipReason; unclear: string | null; fact?: boolean };

const KINDS = [
  'checkable fact',
  'opinion',
  'value judgement',
  'hyperbole',
  'prediction',
  'promise',
  'too vague',
  'trivially true',
] as const;
type Kind = (typeof KINDS)[number];

/** The skipped-statement reason a dropped kind is shown with. */
const SKIPPED_AS: Record<Exclude<Kind, 'checkable fact'>, SkipReason> = {
  opinion: 'opinion',
  'value judgement': 'value judgement',
  hyperbole: 'hyperbole',
  prediction: 'prediction',
  promise: 'promise',
  'too vague': 'too vague to check',
  'trivially true': 'not worth checking',
};

const SYSTEM = `You decide whether one claim from a live political video is worth sending to a nonpartisan fact-checker.

Answer in this order:
1. "reason": one short sentence (25 words at most) on what the claim asserts and whether a source could show it true or false.
2. "kind", one of:
   - "checkable fact": a specific statement a source could show true or false, that a viewer could be misled by: figures, records, rankings, events, who did or said what, comparisons, what a law or policy does.
   - "opinion", "value judgement", "hyperbole", "prediction", "promise": as named. Loaded words around a checkable fact don't make it an opinion: "Their reckless policies doubled gas prices" is a checkable fact (gas prices doubled).
   - "too vague": no specific fact a source could settle ("We have a plan for the border", "Things are getting better").
   - "trivially true": true by definition or known to everyone, so no one could be misled ("The president has an immigration policy", "Congress passes laws").
3. "unclear": the words in the claim that refer to someone or something the claim never names, so a reader can't tell who or what it is about ("they", "that correction", "the program"), quoted exactly; or null. Words for the speaker ("I", "we", "my administration") are never unclear.
Reply with JSON only.`;

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reason', 'kind', 'unclear'],
  properties: {
    reason: { type: 'string' },
    kind: { type: 'string', enum: KINDS },
    unclear: { type: ['string', 'null'] },
  },
};

export function reviewPrompt(input: ReviewInput): string {
  return [
    ...(input.saidOn ? [`Said on: ${input.saidOn}`] : []),
    ...(input.speaker ? [`Said by: ${input.speaker}`] : []),
    'Claim to review:',
    `"${input.claim}"`,
  ].join('\n');
}

export async function reviewClaim(model: JsonModel, input: ReviewInput): Promise<Review> {
  const reply = await model.generate({ name: 'claim_review', system: SYSTEM, user: reviewPrompt(input), schema: SCHEMA });
  return parseReview(reply, input.claim);
}

/** Words that refer to the speaker: the speaker gate settles those, never the review. */
const SPEAKER_WORDS = /^(?:i|me|my|mine|we|us|our|ours|my administration|our administration|this administration)$/i;

function parseReview(reply: unknown, claim: string): Review {
  if (typeof reply !== 'object' || reply === null) throw new ProviderError('failed', 'claim review reply does not match its schema');
  const r = reply as Record<string, unknown>;
  const kind = KINDS.find((k) => k === r.kind);
  if (!kind) throw new ProviderError('failed', 'claim review reply does not match its schema');
  const said = typeof r.unclear === 'string' ? r.unclear.trim().replace(/^["“”']+|["“”']+$/g, '') : '';
  // Unclear words count only if the claim says them, they point elsewhere (a pronoun, a bare "that"), and they aren't the speaker's.
  const unclear = said && !SPEAKER_WORDS.test(said) && refersElsewhere(said) && hasWords(claim, said) ? said : null;
  if (unclear) return { keep: false, reason: 'not self-contained', unclear, fact: kind === 'checkable fact' };
  if (kind === 'checkable fact') return { keep: true };
  return { keep: false, reason: SKIPPED_AS[kind], unclear: null };
}

/** Whether `words` appear in `text`, ignoring case and punctuation. */
export function hasWords(text: string, words: string): boolean {
  const norm = (t: string) => ` ${t.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim()} `;
  const w = norm(words);
  return w.trim().length > 0 && norm(text).includes(w);
}
