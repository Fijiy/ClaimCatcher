// Reads an audio track's frames as mono samples, with Chrome's breakout-box
// API (`MediaStreamTrackProcessor`). Used in the tab for the page's media
// element (page-audio.ts) and in the offscreen document for tabCapture
// (tab-audio.ts).

// Not in TypeScript's DOM types yet.
interface AudioDataLike {
  numberOfChannels: number;
  numberOfFrames: number;
  sampleRate: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void;
  close(): void;
}
declare const MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioDataLike> };

/** Calls `onFrame` with each frame of `track`, mixed to mono, until stopped or the track ends. Returns the stop function. */
export function readMonoFrames(track: MediaStreamTrack, onFrame: (mono: Float32Array, sampleRate: number) => void): () => void {
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  let stopped = false;
  void (async () => {
    try {
      for (;;) {
        const { value: data, done } = await reader.read();
        if (done || stopped) {
          data?.close();
          break;
        }
        try {
          onFrame(toMono(data), data.sampleRate);
        } finally {
          data.close();
        }
      }
    } catch {
      // The track ended or its source went away; nothing more to read.
    }
  })();
  return () => {
    stopped = true;
    void reader.cancel().catch(() => {});
  };
}

function toMono(data: AudioDataLike): Float32Array {
  const mono = new Float32Array(data.numberOfFrames);
  const plane = new Float32Array(data.numberOfFrames);
  for (let c = 0; c < data.numberOfChannels; c++) {
    data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    for (let i = 0; i < plane.length; i++) mono[i] = mono[i]! + plane[i]! / data.numberOfChannels;
  }
  return mono;
}
