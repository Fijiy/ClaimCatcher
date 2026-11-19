// The same words heard again: a replay or a seek back (the on-device
// transcript has no cue ids to spot those by), or captions and the on-device
// transcript both giving a stretch of speech while the transcript switches.
// A sentence whose words nearly all match one already sent to the checks,
// said within REPEAT_SECONDS of it (media time), isn't checked again, so one
// claim never makes two cards.

import type { Sentence } from './checks/sentences';

/** How far apart (seconds of media time) the same words count as heard again. */
export const REPEAT_SECONDS = 20;
/** Of the shorter sentence's words, the share the other must have. */
const SAME_WORDS = 0.8;
/** How many recent sentences are remembered. */
const KEPT = 100;

export interface RepeatGuard {
  /** Whether the sentence was heard before; if not, remembers it. */
  seen(sentence: Sentence): boolean;
  clear(): void;
}

export function createRepeatGuard(): RepeatGuard {
  let heard: Array<{ time: number; words: string[] }> = [];
  return {
    seen(sentence) {
      const words = wordsOf(sentence.text);
      if (words.length === 0) return false;
      const again = heard.some((h) => Math.abs(h.time - sentence.time) <= REPEAT_SECONDS && alike(h.words, words));
      if (!again) heard = [...heard, { time: sentence.time, words }].slice(-KEPT);
      return again;
    },
    clear() {
      heard = [];
    },
  };
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[’']/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Nearly all of the shorter one's words are in the longer one. */
function alike(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  // A very short sentence ("Thank you.") is said again for real.
  if (short.length < 4) return false;
  return short.filter((w) => long.has(w)).length / short.length >= SAME_WORDS;
}
