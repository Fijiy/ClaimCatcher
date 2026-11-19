// How late each caption source runs behind the speech, in seconds. This is
// the one place these numbers live. Every reader shifts its times earlier by
// its lag, so cards and Replay land on when the words were spoken.
//
// Measured in task/site-capture-test (FINDINGS.md, caption-vs-audio lag with
// word timestamps; median, p10–p90 in brackets):
//   YouTube recorded auto captions   0.1 s (0.0–0.3)   -> no shift
//   YouTube live auto captions       6.1 s (3.6–8.4)
//   House floor player, CC1          4.1 s (2.8–4.8), even on the archive
// `<track>` cues are pop-on and lined up with the media in every test, so the
// generic reader isn't shifted.

import type { CaptionSegment } from '../session/types';

export const CAPTION_LAG_SECONDS = {
  track: 0,
  youtubeRecorded: 0,
  youtubeLive: 6,
  house: 4,
} as const;

/** The segment with its times moved `lagSeconds` earlier, never before the start of the media. */
export function shiftEarlier(segment: CaptionSegment, lagSeconds: number): CaptionSegment {
  if (lagSeconds === 0) return segment;
  const shift = (time: number) => Math.max(0, round(time - lagSeconds));
  return { ...segment, start: shift(segment.start), end: shift(segment.end) };
}

// Keeps float noise (14220.63 - 4 = 14216.630000000001) out of the transcript.
function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
