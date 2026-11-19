// Media times for tabCapture audio. A tabCapture stream is the whole tab's
// sound, with no media element clock, but transcript lines need the video's
// own time (Replay seeks to it). So the frames are counted from the player's
// time whenever the page can show it: a blocked player is still in the page
// (only its sound is out of reach), and the in-page capture reports its
// `currentTime`. When the count and the player disagree by more than a
// little (a seek, a pause), the player wins. A video embedded from another
// site shows the page nothing, so its audio is timed from when capture began.

/** Count and player this far apart: the player moved (seek, pause), so take its time. */
const RESYNC_SECONDS = 0.4;

export interface TabClock {
  /** The page's player is at media time `seconds` now. */
  playerAt(seconds: number): void;
  /** The media time a frame of `seconds` of audio starts at; the count moves on past it. */
  frame(seconds: number): number;
}

export function createTabClock(): TabClock {
  let next = 0;
  return {
    playerAt(seconds) {
      if (Number.isFinite(seconds) && Math.abs(seconds - next) > RESYNC_SECONDS) next = seconds;
    },
    frame(seconds) {
      const start = next;
      next = start + seconds;
      return start;
    },
  };
}
