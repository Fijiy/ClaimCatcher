// Scoring for the speech-to-text gate, by eval/README.md's rules: normalise
// both sides the same way, drop fillers and `NAME:` labels, and treat each
// `[unclear: …]` span as a wildcard that matches any run of words (or none)
// and isn't counted. Ported from prototype/local-mode-eval (prep.py, score.py).

import { EPSILON, percent } from './score';

/** The bar: word error rate over every clip's words. */
export const WER_BAR = 0.1;

const LABEL = /^([A-Z][A-Z .'-]+):\s*/gm;
const UNCLEAR = /\[unclear:[^\]]*\]/g;
const FILLERS = new Set(['uh', 'um', 'er', 'ah', 'mm', 'hmm']);
/** Stands for an [unclear] span in the reference. */
const WILDCARD = '\u0000';

/** Lowercase, no punctuation, `%` → percent, no commas in numbers, gonna → going to, hyphens split, no fillers. */
export function normaliseWords(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2')
    .replaceAll('%', ' percent')
    .replaceAll('gonna', 'going to')
    .replaceAll('wanna', 'want to')
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9$' ]/g, ' ')
    .replaceAll("'", '');
  return t.split(/\s+/).filter((w) => w !== '' && !FILLERS.has(w));
}

/** The reference's words, with each [unclear] span as one wildcard. */
export function referenceWords(text: string): string[] {
  const parts = text.replace(LABEL, '').replace(UNCLEAR, WILDCARD).split(WILDCARD);
  return parts.flatMap((part, i) => (i === 0 ? normaliseWords(part) : [WILDCARD, ...normaliseWords(part)]));
}

/**
 * Edit distance in words between a reference transcript and what was heard,
 * and the reference's word count. A wildcard absorbs any run of heard words
 * for free; its words aren't counted.
 */
export function wordErrors(reference: string, heard: string): { errors: number; words: number } {
  const ref = referenceWords(reference);
  const hyp = normaliseWords(heard);
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (const word of ref) {
    const cur = new Array<number>(hyp.length + 1);
    if (word === WILDCARD) {
      let best = Infinity;
      for (let j = 0; j <= hyp.length; j++) cur[j] = best = Math.min(best, prev[j]!);
    } else {
      cur[0] = prev[0]! + 1;
      for (let j = 1; j <= hyp.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (word === hyp[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return { errors: prev[hyp.length]!, words: ref.filter((w) => w !== WILDCARD).length };
}

/** One clip through speech-to-text. */
export interface HeardClip {
  clip: string;
  /** clips.json's `reference_transcript.text`. */
  reference: string;
  /** Every on-device segment's words, in order. */
  heard: string;
  /** The clip's length. */
  seconds: number;
  /** Time spent in speech-to-text. */
  ms: number;
}

export interface WerScore {
  /** Errors over reference words, pooled over every clip. */
  wer: number;
  errors: number;
  words: number;
  /** Speech-to-text time over audio time. */
  realTime: number;
  clips: Array<{ clip: string; wer: number; errors: number; words: number }>;
  pass: boolean;
}

export function scoreWer(clips: HeardClip[]): WerScore {
  const scored = clips.map((c) => {
    const { errors, words } = wordErrors(c.reference, c.heard);
    return { clip: c.clip, wer: words === 0 ? 0 : errors / words, errors, words };
  });
  const errors = scored.reduce((n, c) => n + c.errors, 0);
  const words = scored.reduce((n, c) => n + c.words, 0);
  const wer = words === 0 ? 0 : errors / words;
  const audio = clips.reduce((n, c) => n + c.seconds, 0);
  return {
    wer,
    errors,
    words,
    realTime: audio === 0 ? 0 : clips.reduce((n, c) => n + c.ms, 0) / 1000 / audio,
    clips: scored,
    pass: words > 0 && wer <= WER_BAR + EPSILON,
  };
}

export function formatWerReport(title: string, score: WerScore): string {
  const width = Math.max(...score.clips.map((c) => c.clip.length), 10) + 2;
  return [
    `Speech-to-text gate: ${title}`,
    `${score.clips.length} clips, ${score.words} reference words (outside [unclear] spans)`,
    '',
    `  ${score.pass ? 'PASS' : 'FAIL'}  ${'Word error rate'.padEnd(30)}${percent(score.wer).padEnd(24)}target ≤ ${percent(WER_BAR)}`,
    '',
    `Gate: ${score.pass ? 'PASS' : 'FAIL'}`,
    '',
    `Speech-to-text time: ${percent(score.realTime)} of the audio's length`,
    '',
    'Per clip:',
    ...score.clips.map((c) => `  ${c.clip.padEnd(width)}${percent(c.wer).padStart(6)}   ${c.errors}/${c.words}`),
  ].join('\n');
}
