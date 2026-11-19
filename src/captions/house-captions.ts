// The House floor reader's logic, apart from the player: `cueenter` events
// from live.house.gov's Bitmovin player in, lag-shifted caption segments out.
//
// The player carries embedded CEA-608 captions as two tracks, CC1 (English)
// and CC3 (Spanish), both with language 'unknown'. Only CC1 is read. Its
// captions roll up two lines at a time, so each roll re-enters the line above
// alongside the new one; a line already on screen is not taken again.

import type { CaptionSegment } from '../session/types';
import { CAPTION_LAG_SECONDS, shiftEarlier } from './lag';

/** The parts of a Bitmovin `SubtitleCueEvent` the reader uses. */
export interface HouseCue {
  subtitleId: string;
  /** Player time the cue is shown, in seconds. */
  start: number;
  end?: number;
  text: string;
}

/**
 * The English track's id. CEA-608 channel 1; the player names tracks by
 * channel and reports every language as 'unknown', so language can't pick it.
 */
export const ENGLISH_TRACK = 'CC1';

export interface HouseCaptions {
  /** One `cueenter` event. Returns the new line it shows, if any. */
  cue(cue: HouseCue): CaptionSegment[];
}

/** Lines visible at once in the roll-up. */
const ROLL_UP_LINES = 2;

export function createHouseCaptions(): HouseCaptions {
  const onScreen: string[] = []; // the lines the roll-up shows now, oldest first
  return {
    cue(cue) {
      if (cue.subtitleId !== ENGLISH_TRACK) return [];
      const text = clean(cue.text);
      if (!text || onScreen.includes(text)) return [];
      onScreen.push(text);
      if (onScreen.length > ROLL_UP_LINES) onScreen.shift();
      const end = Math.max(cue.start, cue.end ?? cue.start);
      return [shiftEarlier({ reader: 'house', start: cue.start, end, text }, CAPTION_LAG_SECONDS.house)];
    },
  };
}

/**
 * The words of a cue: the stenographer's anonymous "SPEAKER 1:" tags and ">>"
 * speaker-change marks removed (they are never names), whitespace collapsed.
 */
function clean(text: string): string {
  return text
    .replace(/\bSPEAKER \d+:/g, ' ')
    .replace(/>>+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
