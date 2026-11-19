// The long-lived port between the in-page audio capture (page-audio.ts) and
// the offscreen document. PCM is far too frequent for one-off messages, so it
// goes over a `runtime.connect` port that lives as long as listening does:
// when the offscreen document closes, the port disconnects and the page stops
// capturing.
//
// Audio only ever moves between these two extension contexts, on the device.

export const AUDIO_PORT = 'claimcatcher-audio';

import type { BlockedPlayer } from '../session/types';

/**
 * Why the page's player can't be captured; the blocked-player fallback offers tabCapture.
 * `cross-origin`: "Cannot capture from element with cross-origin data" (media from another origin, no CORS).
 * `drm`: "Stream capture not supported with EME". `embed`: the video is in a frame from another site.
 */
export type CaptureFailure = BlockedPlayer;

export type PageAudioMessage =
  /** About 250 ms of mono audio: 16-bit PCM in base64 (pcm.ts), at `sampleRate`, starting at media time `time`. */
  | { type: 'pcm'; sampleRate: number; time: number; data: string }
  | { type: 'capture-failed'; failure: CaptureFailure; message: string }
  /** A player that can't be captured is at media time `time` now (about every 500 ms): the time base for tabCapture audio. */
  | { type: 'player-time'; time: number };
