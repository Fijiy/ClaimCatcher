// tabCapture: the second approach in the spec's capture order, for a player
// that blocks direct listening (media from another origin, DRM, a video
// embedded from another site). Runs in the offscreen document. The service
// worker gets the stream ID (it holds the tabCapture permission and the tab's
// grant); this opens it, plays it back, and hands on its audio in batches of
// about 250 ms, timed by a TabClock (tab-clock.ts).
//
// While a tab is captured Chrome stops playing its sound to the viewer, so
// the stream is played back here. The audio goes nowhere else but the
// transcriber: it never leaves the device.

import type { TabClock } from './tab-clock';
import { readMonoFrames } from './track-frames';

const BATCH_SECONDS = 0.25;

export interface TabAudioOutputs {
  /** Mono samples at `sampleRate`, starting at media time `time` (seconds). */
  frame(sampleRate: number, samples: Float32Array, time: number): void;
  /** The capture ended by itself (the tab closed, or Chrome stopped it). */
  ended(): void;
}

/** Opens the tab's audio from a tabCapture stream ID. Resolves to a function that stops it. */
export async function captureTabAudio(streamId: string, clock: TabClock, out: TabAudioOutputs): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Chrome's own constraints for a tabCapture stream; not in the standard types.
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false,
  });
  const [track] = stream.getAudioTracks();
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('the tab capture stream has no audio');
  }
  // The viewer goes on hearing the tab.
  const playback = new AudioContext();
  playback.createMediaStreamSource(stream).connect(playback.destination);

  let batch: Float32Array[] = [];
  let batchLength = 0;
  let batchRate = 0;
  const send = () => {
    if (batchLength === 0) return;
    const samples = new Float32Array(batchLength);
    let at = 0;
    for (const part of batch) {
      samples.set(part, at);
      at += part.length;
    }
    out.frame(batchRate, samples, clock.frame(batchLength / batchRate));
    batch = [];
    batchLength = 0;
  };
  const stopReading = readMonoFrames(track, (mono, sampleRate) => {
    if (batchLength > 0 && sampleRate !== batchRate) send();
    batchRate = sampleRate;
    batch.push(mono);
    batchLength += mono.length;
    if (batchLength >= batchRate * BATCH_SECONDS) send();
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopReading();
    stream.getTracks().forEach((t) => t.stop());
    void playback.close().catch(() => {});
  };
  track.addEventListener('ended', () => {
    if (stopped) return;
    stop();
    out.ended();
  });
  return stop;
}
