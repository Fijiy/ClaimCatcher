// Where the transcript comes from. The page's captions are preferred; the
// on-device transcript (speech-to-text of the tab's audio, which is captured
// the whole time listening is on) is shown only while captions are missing:
//
//   captions    on-device segments are held back, not shown. If no caption
//               arrives for TAKE_OVER_MS while audio is flowing, switch, and
//               show what was heard since the last caption. A piece of
//               audio that began before the captions ended loses the words
//               the captions already gave (when they line up).
//   on-device   on-device segments become lines. The next caption switches
//               back at once.
//
// Time with no audio (paused, muted at the source, silence) doesn't count
// towards the switch, so pausing a captioned video doesn't change the source.
// A short pause holds the count rather than starting it again: speech broken
// by pauses (each long enough for audio to stop flowing for a moment) still
// switches after about 10 s of it. A caption, or a pause longer than
// HOLD_MS (the viewer paused the video), starts it again.

import type { CaptionSegment, Clock, OnDeviceSegment, TimerHandle, TranscriptSource } from './types';

/** How long captions may be missing, with audio flowing, before the on-device transcript takes over. */
export const TAKE_OVER_MS = 10_000;
/** A pause in the audio up to this long keeps the time already counted towards the switch. */
const HOLD_MS = 10_000;
/** How much held-back on-device transcript is kept for the switch, in seconds of media time. */
const HELD_SECONDS = 30;
/** How many of the captions' last words are kept to spot the on-device transcript repeating them. */
const CAPTION_TAIL_WORDS = 40;

export interface TranscriptSwitch {
  /** A caption arrived; captions take (back) over. */
  caption(segment: CaptionSegment): void;
  /** An on-device segment arrived; it is shown now, held back, or dropped. */
  onDevice(segment: OnDeviceSegment): void;
  audio(flowing: boolean): void;
  /** A new video (a new page): forget the old one's caption times and held audio. */
  newMedia(): void;
  close(): void;
}

export interface SwitchOutputs {
  /** The source changed. */
  switched(source: TranscriptSource): void;
  /** An on-device segment to show as a transcript line. */
  show(segment: OnDeviceSegment): void;
}

export function createTranscriptSwitch(clock: Clock, out: SwitchOutputs): TranscriptSwitch {
  let source: TranscriptSource = 'captions';
  let flowing = false;
  let timer: TimerHandle | null = null;
  /** Flowing time counted since the last caption, in ms, up to when the running stretch began. */
  let counted = 0;
  /** When the running stretch of flowing audio began (clock ms), while the timer runs. */
  let stretchFrom = 0;
  /** When audio last stopped flowing (clock ms). */
  let stoppedAt = -Infinity;
  /** Media time the last caption ended; on-device words before it were already captioned. */
  let captionedUntil = -Infinity;
  let held: OnDeviceSegment[] = [];
  let captionTail: string[] = [];

  function show(segment: OnDeviceSegment) {
    if (segment.start >= captionedUntil) return out.show(segment);
    const text = afterOverlap(captionTail, segment.text);
    if (text) out.show({ ...segment, text });
  }

  /** Stops counting, keeping the flowing time counted so far. */
  function stopTimer() {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
    counted += clock.now() - stretchFrom;
  }

  /** Counts on towards the switch, if it should be counting. */
  function count() {
    stopTimer();
    if (source !== 'captions' || !flowing) return;
    stretchFrom = clock.now();
    timer = clock.setTimeout(takeOver, Math.max(0, TAKE_OVER_MS - counted));
  }

  function takeOver() {
    timer = null;
    counted = 0;
    source = 'on-device';
    out.switched(source);
    for (const segment of held) if (segment.end > captionedUntil) show(segment);
    held = [];
  }

  return {
    caption(segment) {
      captionedUntil = Math.max(captionedUntil, segment.end);
      captionTail = [...captionTail, ...segment.text.split(/\s+/).filter(Boolean)].slice(-CAPTION_TAIL_WORDS);
      held = [];
      if (source === 'on-device') {
        source = 'captions';
        out.switched(source);
      }
      stopTimer();
      counted = 0;
      count();
    },
    onDevice(segment) {
      if (source === 'on-device') return show(segment);
      held.push(segment);
      held = held.filter((s) => s.end >= segment.end - HELD_SECONDS);
    },
    audio(nowFlowing) {
      if (nowFlowing === flowing) return;
      flowing = nowFlowing;
      if (!flowing) stoppedAt = clock.now();
      else if (clock.now() - stoppedAt > HOLD_MS) {
        stopTimer();
        counted = 0;
      }
      count();
    },
    newMedia() {
      captionedUntil = -Infinity;
      captionTail = [];
      held = [];
    },
    close() {
      stopTimer();
      counted = 0;
      held = [];
    },
  };
}

const norm = (word: string) => word.toLowerCase().replace(/[^a-z0-9']/g, '');

/**
 * The on-device text without its first words where they repeat the captions'
 * last words (the longest such overlap, ignoring case and punctuation).
 * Without an overlap, all of it.
 */
function afterOverlap(captionWords: string[], text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const tail = captionWords.map(norm);
  const head = words.map(norm);
  for (let k = Math.min(tail.length, head.length); k > 0; k--) {
    if (tail.slice(-k).every((w, i) => w === head[i])) return words.slice(k).join(' ');
  }
  return text;
}
