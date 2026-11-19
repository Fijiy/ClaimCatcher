// The YouTube reader's logic, apart from the DOM: snapshots of the
// `.ytp-caption-segment` overlay in, lag-shifted caption segments out.
// `youtube-reader.ts` feeds it from the page.

import type { CaptionSegment } from '../session/types';
import { CAPTION_LAG_SECONDS, shiftEarlier } from './lag';
import { createRollingLines, type RollingLine } from './rolling-lines';

export interface YouTubeCaptions {
  /** Every caption segment's text on screen at media time `time`, joined. */
  update(text: string, time: number): CaptionSegment[];
  /** The media clock reached `time`. */
  tick(time: number): CaptionSegment[];
  /** Listening stopped: whatever is still open. */
  flush(): CaptionSegment[];
}

export function createYouTubeCaptions(options: { live: () => boolean }): YouTubeCaptions {
  const lines = createRollingLines();
  const toSegments = (closed: RollingLine[]) =>
    closed.map((line) =>
      shiftEarlier(
        { reader: 'youtube', ...line },
        options.live() ? CAPTION_LAG_SECONDS.youtubeLive : CAPTION_LAG_SECONDS.youtubeRecorded,
      ),
    );
  return {
    update: (text, time) => toSegments(lines.update(stripMarkers(text), time)),
    tick: (time) => toSegments(lines.tick(time)),
    flush: () => toSegments(lines.flush()),
  };
}

/** Broadcast captions mark a change of speaker with ">>"; it isn't a word. */
function stripMarkers(text: string): string {
  return text.replace(/>>+/g, ' ');
}
