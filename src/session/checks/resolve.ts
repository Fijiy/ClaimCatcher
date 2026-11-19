// Stage 1b′, one more try at a claim breakdown left unresolved ("The only
// jobs he created…", "Money is being paid to many of them"): a short prompt
// asks who or what the words refer to, from the earlier transcript and the
// video's details only. The answer counts only if those (or the sentence)
// say it, word for word: never a name the model brings from elsewhere. Then
// the words are replaced by it ("he" → "Joe Biden", "his" → "Joe Biden's").
// Without an answer the claim stays not self-contained.

import { ProviderError, type JsonModel, type JsonSchema } from './provider';
import { refersElsewhere } from './tidy';

export interface ResolveInput {
  /** The claim as breakdown wrote it. */
  claim: string;
  /** The words in it no one named ("he", "them"). */
  words: string;
  sentence: string;
  /** About 30 s of what was said before the sentence. */
  context: string;
  title: string;
  channel?: string;
  /** Only for an on-device model, as for breakdown. */
  description?: string;
}

const SYSTEM = `You find who or what a word in a claim from a live political video refers to.
Use only the earlier transcript, the sentence and the video's details given. Never use what you know about anyone's views, party or positions.
"refers_to": the person, group or thing the words refer to, copied exactly as they are written in the transcript, the sentence or the video's details; or null if those don't say.
Reply with JSON only.`;

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['refers_to'],
  properties: { refers_to: { type: ['string', 'null'] } },
};

export function resolvePrompt(input: ResolveInput, onDevice = false): string {
  const description = onDevice ? input.description?.trim() : undefined;
  return [
    `Video: "${input.title}"${input.channel ? `, channel "${input.channel}"` : ''}`,
    ...(description ? [`Video description: "${description}"`] : []),
    '',
    'What was said in the ~30 seconds before:',
    `"${input.context || '(nothing)'}"`,
    '',
    'Sentence:',
    `"${input.sentence}"`,
    '',
    `Who or what does "${input.words}" refer to in this claim?`,
    `"${input.claim}"`,
  ].join('\n');
}

/** The claim with its words replaced by what they refer to, or null if that can't be told from what was given. */
export async function resolveReference(model: JsonModel, input: ResolveInput): Promise<string | null> {
  const onDevice = model.onDevice === true;
  const reply = await model.generate({ name: 'reference', system: SYSTEM, user: resolvePrompt(input, onDevice), schema: SCHEMA });
  if (typeof reply !== 'object' || reply === null) throw new ProviderError('failed', 'reference reply does not match its schema');
  const said = (reply as Record<string, unknown>).refers_to;
  const referent = typeof said === 'string' ? said.trim().replace(/^["“”']+|["“”']+$/g, '').replace(/[.,;:]+$/, '').trim() : '';
  if (!referent || (PRONOUN.test(` ${referent.toLowerCase()} `) && referent.split(/\s+/).length === 1)) return null;
  if (/^(?:null|none|unknown|the speaker|speaker)$/i.test(referent)) return null;
  // "many of them" for "them" names no one.
  if (refersElsewhere(referent)) return null;
  const given = [input.context, input.sentence, input.title, input.channel ?? '', onDevice ? (input.description ?? '') : ''].join(' \n ');
  if (!contains(given, referent)) return null;
  return substitute(input.claim, input.words, referent);
}

const PRONOUN = / (?:they|them|their|theirs|he|him|his|she|her|hers|it|its|this|that|these|those|we|us|our|i|me|my|you|your) /;
const POSSESSIVE = /^(?:their|his|her|its)$/i;

const norm = (t: string) => ` ${t.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim()} `;

function contains(text: string, words: string): boolean {
  const w = norm(words).replace(/'s /g, ' ');
  return w.trim().length > 0 && norm(text).replace(/'s /g, ' ').includes(w);
}

/** The claim with the first `words` replaced by `referent` ("his plan" → "Joe Biden's plan"). */
function substitute(claim: string, words: string, referent: string): string {
  const escaped = words.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = new RegExp(`(^|[^\\p{L}])(${escaped})(?=[^\\p{L}]|$)`, 'iu');
  const m = at.exec(claim);
  if (!m) return claim;
  const start = m.index + m[1]!.length;
  const word = m[2]!;
  // "his", "their": the referent's; "they're" keeps its "'re" after the name.
  const replacement = POSSESSIVE.test(word) ? `${referent}'s` : referent;
  const out = `${claim.slice(0, start)}${replacement}${claim.slice(start + word.length)}`;
  return start === 0 ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}
