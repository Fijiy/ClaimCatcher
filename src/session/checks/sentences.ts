// Transcript lines -> sentences. Caption cues don't line up with sentences:
// one cue can hold two sentences, and one sentence can run over several cues.
// Each complete sentence is handed on with about 30 s of what was said before
// it, which is all of the transcript a check ever sees.

import type { Clock, TimerHandle, TranscriptLine } from '../types';

export interface Sentence {
  id: string;
  text: string;
  /** The line the sentence starts on. */
  lineId: string;
  /** When it started, in seconds of media time. */
  time: number;
  /** What was said in the ~30 s before it (CONTEXT_SECONDS), oldest first. */
  context: string;
}

/** How much earlier transcript goes with each sentence. */
export const CONTEXT_SECONDS = 30;
/** A sentence with no closing punctuation is let go after this long without a new line. */
const FLUSH_AFTER_MS = 4_000;

/** A sentence boundary: `.`, `?` or `!` (and any closing quote or bracket), then a space. */
const BOUNDARY = /(?<=[.?!]["'”’)\]]*)\s+/;
const ENDS_SENTENCE = /[.?!]["'”’)\]]*$/;
/**
 * A period that doesn't end a sentence: after an initial or a letter of an
 * acronym ("H. RES.", "U.S."), or a common abbreviation. House captions are all
 * caps, so this ignores case. Joining two sentences is cheaper than checking half of one.
 */
const ABBREVIATION = /(?:^|[\s.("'“‘])(?:[a-z]|mr|mrs|ms|dr|sen|rep|res|gov|gen|st|jr|sr|no|vs|etc|e\.g|i\.e)\.$/i;

const endsSentence = (text: string) => ENDS_SENTENCE.test(text) && !ABBREVIATION.test(text);

/** Splits text at sentence ends; the last part may be an unfinished sentence. */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const piece of text.trim().split(BOUNDARY)) {
    current = current ? `${current} ${piece}` : piece;
    if (endsSentence(current)) {
      parts.push(current);
      current = '';
    }
  }
  if (current) parts.push(current);
  return parts;
}

export interface SentenceAssembler {
  add(line: TranscriptLine): void;
  /** Drops any unfinished sentence and its timer. */
  close(): void;
}

export function createSentenceAssembler(clock: Clock, onSentence: (sentence: Sentence) => void): SentenceAssembler {
  let pending: { text: string; lineId: string; time: number } | null = null;
  let timer: TimerHandle | null = null;
  const said: Array<{ text: string; time: number }> = [];
  let count = 0;

  function emit(text: string, lineId: string, time: number) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const context = said
      .filter((s) => s.time >= time - CONTEXT_SECONDS && s.time <= time)
      .map((s) => s.text)
      .join(' ');
    said.push({ text: trimmed, time });
    // Only the context window is ever needed; forget what falls out of it.
    while (said.length > 0 && said[0]!.time < time - CONTEXT_SECONDS) said.shift();
    onSentence({ id: `s${++count}`, text: trimmed, lineId, time, context });
  }

  function flush() {
    timer = null;
    if (pending) emit(pending.text, pending.lineId, pending.time);
    pending = null;
  }

  return {
    add(line) {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      const lineStart = { lineId: line.id, time: line.time };
      const start = pending ? { lineId: pending.lineId, time: pending.time } : lineStart;
      const text = pending ? `${pending.text} ${line.text}` : line.text;
      const parts = splitSentences(text);
      const rest = endsSentence(parts.at(-1)!) ? '' : parts.pop()!;
      parts.forEach((part, i) => {
        const from = i === 0 ? start : lineStart;
        emit(part, from.lineId, from.time);
      });
      // If no sentence ended, the unfinished one still starts where it did.
      pending = rest ? { text: rest, ...(parts.length === 0 ? start : lineStart) } : null;
      if (pending) timer = clock.setTimeout(flush, FLUSH_AFTER_MS);
    },
    close() {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
