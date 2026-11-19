// Stage 1a, code checks on claim breakdown's reply (no model). Gemini Nano in
// particular fills fields with stray words ("no checkable fact", "null",
// "unresolved"), gives the same claim twice, invents a claim from the
// prompt's own examples, and quotes a skip reason as the premise. Before any
// claim is reviewed or searched:
//
//   - stray words in a field are read as no answer;
//   - a claim lifted from the prompt's own examples or from the earlier
//     transcript (and not from the sentence) is dropped, and so is the same
//     claim given twice;
//   - a premise must quote a skipped part (or words of the sentence); a skip
//     reason there is replaced by the skipped part with that reason, if any;
//   - words breakdown couldn't resolve count only if they are a pronoun or a
//     bare "that" ("they", "his", "evidence of that") the claim still says;
//   - time words in the sentence ("in 48 years", "last year", "now") put
//     years into the search queries, counted from the day it was said, and
//     "recent" or "latest" come out of them.

import type { SkippedPart, SkipReason } from '../types';
import { PROMPT_EXAMPLES, type Breakdown, type BrokenDownClaim } from './breakdown';

/**
 * Words that point at someone or something named elsewhere: a pronoun
 * ("they", "his"), or a demonstrative on its own ("no evidence of that").
 * "This country" or "that endless war" name what they mean well enough.
 */
export function refersElsewhere(words: string): boolean {
  const w = words.trim().toLowerCase().replace(/[’']/g, "'");
  if (/\b(?:they|them|their|theirs|they're|they've|they'll|he|him|his|she|her|hers|it|its|it's)\b/.test(w)) return true;
  return /^(?:this|that|these|those)$/.test(w);
}

/** Field values that mean "no answer". */
const NO_ANSWER = new Set(['null', 'none', 'n/a', 'na', 'unresolved', 'unknown', 'no', 'false', 'nothing', '-', 'the speaker', 'speaker']);

const REASONS: readonly SkipReason[] = [
  'opinion',
  'value judgement',
  'hyperbole',
  'rhetorical question',
  'prediction',
  'promise',
  'no checkable fact',
];

/** A field's text, or null when it is empty or a stray word (a skip reason, "null"). */
export function answer(value: string | null): string | null {
  const t = value?.trim().replace(/^["“”']+|["“”']+$/g, '').trim() ?? '';
  if (!t) return null;
  const bare = t.toLowerCase().replace(/[.\s]+$/, '');
  if (NO_ANSWER.has(bare) || REASONS.includes(bare as SkipReason)) return null;
  return t;
}

export interface TidyInput {
  sentence: string;
  /** The ~30 s said before it: a claim taken from there belongs to an earlier sentence. */
  context?: string;
  /** The day it was said, YYYY-MM-DD. */
  saidOn: string;
}

export interface Tidied {
  claims: BrokenDownClaim[];
  /** Claims with words no one named (`unresolved` set): not self-contained as they stand. */
  unresolved: BrokenDownClaim[];
}

export function tidyClaims(breakdown: Breakdown, input: TidyInput): Tidied {
  const sentenceWords = contentWords(input.sentence);
  const contextWords = contentWords(input.context ?? '');
  const kept: BrokenDownClaim[] = [];
  const seen: string[] = [];
  for (const raw of breakdown.claims) {
    const literal = answer(raw.literal);
    if (!literal) continue;
    // Not from this sentence: lifted from the prompt's examples, or from what was said before (an earlier sentence's claim, checked there).
    if (!fromSentence(literal, sentenceWords) && (PROMPT_EXAMPLES.some((e) => sameClaim(e, literal)) || fromSentence(literal, contextWords, 0.6))) continue;
    if (seen.some((k) => sameClaim(k, literal))) continue;
    seen.push(literal);
    const claim: BrokenDownClaim = {
      ...raw,
      literal,
      premiseOf: premise(raw.premiseOf, breakdown.skipped, input.sentence),
      speaker: { ...raw.speaker, words: inText(answer(raw.speaker.words), input.sentence), name: answer(raw.speaker.name) },
      queries: anchored(raw.queries, literal, input),
      unresolved: null,
    };
    const unresolved = answer(raw.unresolved);
    kept.push(unresolved && refersElsewhere(unresolved) && has(literal, unresolved) ? { ...claim, unresolved } : claim);
  }
  return { claims: kept.filter((c) => !c.unresolved), unresolved: kept.filter((c) => !!c.unresolved) };
}

// ---- Words ---------------------------------------------------------------------

const STOP = new Set(
  'the a an and or but of to in on at for from by with as is are was were be been being has have had do does did not no this that these those it its they them their we our us i my me he his she her you your there here than then so very just about over under into out up down more most less least all any each every some such can could will would should may might must'.split(' '),
);

/** The words that carry meaning, cut to 5 letters so "rescue" and "rescuing" meet. */
function contentWords(text: string): string[] {
  return (text.toLowerCase().replace(/[’']/g, "'").match(/[\p{L}\p{N}][\p{L}\p{N}'%]*/gu) ?? [])
    .map((w) => w.replace(/'s$/, '').replace(/'.*$/, ''))
    .filter((w) => (w.length >= 2 || /\d/.test(w)) && !STOP.has(w))
    .map((w) => w.slice(0, 5));
}

/** At least `share` of the claim's words (40% by default) are in these words. */
function fromSentence(literal: string, sentenceWords: string[], share = 0.4): boolean {
  const words = contentWords(literal).filter((w) => !/^\d{4}$/.test(w));
  if (words.length === 0) return false;
  const said = new Set(sentenceWords);
  return words.filter((w) => said.has(w)).length / words.length >= share;
}

/** The same claim: the shorter's words are nearly all in the longer, and they give the same figures. */
function sameClaim(a: string, b: string): boolean {
  const wa = contentWords(a);
  const wb = contentWords(b);
  const numbers = (ws: string[]) => ws.filter((w) => /\d/.test(w)).sort().join(' ');
  if (numbers(wa) !== numbers(wb)) return false;
  const [short, long] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  if (short.length === 0) return true;
  return short.filter((w) => long.has(w)).length / short.length >= 0.8;
}

const norm = (t: string) => ` ${t.toLowerCase().replace(/[’']/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Whether `words` are said in `text`, ignoring case, punctuation and contractions. */
function has(text: string, words: string): boolean {
  const w = norm(words);
  return w.trim().length > 0 && norm(text).includes(w);
}

function inText(words: string | null, text: string): string | null {
  return words && has(text, words) ? words : null;
}

/**
 * The premise a claim rests on, as words of the sentence: the skipped part
 * it quotes, or (when breakdown gave a skip reason instead of words) the
 * skipped part with that reason. Null if it is neither.
 */
function premise(premiseOf: string | null, skipped: SkippedPart[], sentence: string): string | null {
  const raw = premiseOf?.trim().replace(/^["“”']+|["“”']+$/g, '').trim() ?? '';
  if (!raw) return null;
  const reason = REASONS.find((r) => r === raw.toLowerCase().replace(/[.\s]+$/, ''));
  if (reason) return skipped.find((p) => p.reason === reason && has(sentence, p.text))?.text ?? null;
  if (answer(raw) === null) return null;
  const quoted = skipped.find((p) => norm(p.text) === norm(raw));
  if (quoted) return quoted.text;
  return has(sentence, raw) ? raw : null;
}

// ---- Time ------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** "48", "forty eight", "forty-eight", "a hundred" as a number. */
function numberOf(text: string): number | null {
  const t = text.toLowerCase().trim();
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0;
  for (const w of t.split(/[\s-]+/)) {
    if (w === 'a') continue;
    const n = NUMBER_WORDS[w];
    if (n === undefined) return null;
    total = n === 100 ? Math.max(1, total) * 100 : total + n;
  }
  return total > 0 ? total : null;
}

const SPAN = /\b(\d{1,3}|(?:a\s+)?(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen))\s+years?\b/gi;
const LAST_YEAR = /\blast\s+year\b/i;
const NOW = /\b(?:now|today|currently|right now|this year|tonight|so far)\b/i;

/** The years a sentence's time words point at, counted from the year it was said. */
export function anchorYears(sentence: string, saidOn: string): number[] {
  const year = Number(saidOn.slice(0, 4));
  if (!year) return [];
  const years = new Set<number>();
  for (const m of sentence.matchAll(SPAN)) {
    const n = numberOf(m[1]!);
    if (n && n < year) years.add(year - n);
  }
  // A span ("in 48 years") runs up to the year it was said.
  if (years.size > 0 || NOW.test(sentence)) years.add(year);
  if (LAST_YEAR.test(sentence)) years.add(year - 1);
  return [...years].sort();
}

const STALE = /\b(?:recent(?:ly)?|latest|current(?:ly)?|today|now|this year|last year)\b/gi;

/** Queries without "recent" and with the years the sentence's time words point at. */
function anchored(queries: BrokenDownClaim['queries'], literal: string, input: TidyInput): BrokenDownClaim['queries'] {
  const years = anchorYears(input.sentence, input.saidOn).map(String);
  const fix = (query: string) => {
    const q = query.replace(STALE, ' ').replace(/\s+/g, ' ').trim() || literal;
    const missing = years.filter((y) => !q.includes(y));
    return missing.length > 0 ? `${q} ${missing.join(' ')}` : q;
  };
  return { fact: fix(queries.fact), claim: fix(queries.claim) };
}
