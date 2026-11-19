// In-page audio capture: the first approach in the spec's capture order.
// Runs in the listened tab (ISOLATED world), injected under the icon click's
// activeTab grant, so it needs no host permission.
//
// It picks the page's playing media element, takes its audio with
// `captureStream()` (which leaves playback alone: the viewer still hears it),
// reads the audio track's frames with `MediaStreamTrackProcessor`, mixes them
// to mono and hands them on about every 250 ms with the media time they
// start at. A MediaStream can't be messaged to the offscreen document, so the
// samples go as PCM (see port.ts); converting them for the models happens
// there.
//
// A player that blocks this (media from another origin, DRM, or a video
// embedded from another site, in a frame this script can't reach) is
// reported once, so the blocked-player fallback can take the tab's audio
// with tabCapture instead. While a blocked player is in the page, its
// `currentTime` is reported about every 500 ms: tabCapture has no clock of
// its own, and transcript times are the video's.

import type { CaptureFailure } from './port';
import { readMonoFrames } from './track-frames';

export interface PageAudioOutputs {
  /** Mono samples at `sampleRate`, starting at media time `time` (seconds). */
  frame(sampleRate: number, samples: Float32Array, time: number): void;
  /** The player can't be captured (cross-origin media, DRM, an embed from another site). */
  failed(failure: CaptureFailure, message: string): void;
  /** The player that can't be captured is at media time `seconds` now. */
  playerAt(seconds: number): void;
}

/** How much audio goes in one message. */
const BATCH_SECONDS = 0.25;
/** A frame's media time this far from the running count is a seek: take the element's clock again. */
const RESYNC_SECONDS = 0.3;
/** How often a blocked player's time is reported, and the page is looked at again for an embed. */
const CHECK_MS = 500;
/** A frame from another site at least this big (CSS px) is taken for an embedded player. */
const EMBED_MIN = { width: 200, height: 112 };

/** Starts capturing. Returns a function that stops and lets go of everything. */
export function capturePageAudio(doc: Document, out: PageAudioOutputs): () => void {
  let current: { media: HTMLMediaElement; stop: () => void } | null = null;
  /** The page's player, when it can't be captured. */
  let blocked: HTMLMediaElement | null = null;
  /** The last failure reported, so each is reported once. */
  let reported: string | null = null;
  let stopped = false;

  function fail(failure: CaptureFailure, message: string) {
    if (reported === failure) return;
    reported = failure;
    out.failed(failure, message);
  }

  function attach(media: HTMLMediaElement) {
    if (current?.media === media) return;
    let stream: MediaStream;
    try {
      stream = (media as HTMLMediaElement & { captureStream(): MediaStream }).captureStream();
    } catch (error) {
      if (current) return; // another element is being heard; keep it
      blocked = media;
      fail(classify(error), error instanceof Error ? error.message : String(error));
      return;
    }
    blocked = null;
    reported = null;
    current?.stop();
    const readers = new Map<MediaStreamTrack, () => void>();
    const follow = (track: MediaStreamTrack) => {
      if (track.kind !== 'audio' || readers.has(track)) return;
      readers.set(track, readTrack(media, track, out));
    };
    stream.getAudioTracks().forEach(follow);
    // Tracks appear once the element has loaded its media.
    const onAddTrack = (event: MediaStreamTrackEvent) => follow(event.track);
    stream.addEventListener('addtrack', onAddTrack);
    current = {
      media,
      stop() {
        stream.removeEventListener('addtrack', onAddTrack);
        for (const stopReading of readers.values()) stopReading();
        for (const track of stream.getTracks()) track.stop();
      },
    };
  }

  /** The element to listen to: one that is playing (a video first), else one that has media. */
  function pick(): HTMLMediaElement | undefined {
    const all = [...doc.querySelectorAll<HTMLMediaElement>('video, audio')];
    const playing = all.filter((m) => !m.paused && m.readyState >= 2);
    return playing.find((m) => m instanceof HTMLVideoElement) ?? playing[0] ?? (current ? undefined : all.find((m) => m.readyState >= 1));
  }

  function update() {
    if (stopped) return;
    const media = pick();
    if (media) attach(media);
  }

  function check() {
    if (stopped || current) return;
    if (blocked) return out.playerAt(blocked.currentTime);
    // No player of its own: the video may be embedded from another site.
    const hasMedia = [...doc.querySelectorAll<HTMLMediaElement>('video, audio')].some((m) => m.currentSrc || m.readyState > 0);
    const frame = hasMedia ? undefined : embeddedPlayer(doc);
    if (frame) fail('embed', `The video is in a frame from ${frame}`);
  }

  // Whatever starts playing later (the viewer presses play, an SPA swaps the
  // player) is picked up. Media events don't bubble, so listen in the capture phase.
  doc.addEventListener('playing', update, true);
  doc.addEventListener('loadedmetadata', update, true);
  update();
  check();
  const checking = setInterval(check, CHECK_MS);

  return () => {
    stopped = true;
    clearInterval(checking);
    doc.removeEventListener('playing', update, true);
    doc.removeEventListener('loadedmetadata', update, true);
    current?.stop();
    current = null;
  };
}

/** Reads one audio track until stopped, in batches with their media time; returns the stop function. */
function readTrack(media: HTMLMediaElement, track: MediaStreamTrack, out: PageAudioOutputs): () => void {
  let batch: Float32Array[] = [];
  let batchLength = 0;
  let batchRate = 0;
  let batchTime = 0;
  /** Media time the next frame should start at, by counting samples. */
  let next: number | null = null;

  function send() {
    if (batchLength === 0) return;
    const samples = new Float32Array(batchLength);
    let at = 0;
    for (const part of batch) {
      samples.set(part, at);
      at += part.length;
    }
    out.frame(batchRate, samples, batchTime);
    batch = [];
    batchLength = 0;
  }

  return readMonoFrames(track, (mono, sampleRate) => {
    const seconds = mono.length / sampleRate;
    // The element's clock is at about the end of this frame.
    const clock = media.currentTime - seconds;
    const time: number = next !== null && Math.abs(clock - next) < RESYNC_SECONDS ? next : clock;
    if (batchLength > 0 && (sampleRate !== batchRate || time !== next)) send();
    if (batchLength === 0) {
      batchTime = time;
      batchRate = sampleRate;
    }
    batch.push(mono);
    batchLength += mono.length;
    next = time + seconds;
    if (batchLength >= batchRate * BATCH_SECONDS) send();
  });
}

/** The origin of the biggest visible frame from another origin, if one is big enough to be a video player. */
function embeddedPlayer(doc: Document): string | undefined {
  let best: { origin: string; area: number } | undefined;
  for (const frame of doc.querySelectorAll('iframe')) {
    let origin: string;
    try {
      origin = new URL(frame.src, doc.baseURI).origin;
    } catch {
      continue;
    }
    if (origin === 'null' || origin === doc.location.origin) continue; // about:blank, srcdoc, same origin
    const { width, height } = frame.getBoundingClientRect();
    if (width < EMBED_MIN.width || height < EMBED_MIN.height) continue;
    if (!best || width * height > best.area) best = { origin, area: width * height };
  }
  return best?.origin;
}

function classify(error: unknown): CaptureFailure {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'SecurityError') return 'cross-origin';
  if (name === 'NotSupportedError') return 'drm';
  return 'other';
}
