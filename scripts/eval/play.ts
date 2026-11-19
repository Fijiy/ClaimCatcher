// Plays clip audio through the shipped transcriber (src/audio/transcriber.ts),
// as the offscreen document does with a tab's audio: frames at the media
// element's rate, with media times, resampled, cut into pieces at pauses,
// then speech-to-text (and voice separation, when given) on each piece.
//
// It runs faster than real time but never lets pieces queue: after each frame
// it waits until the models are idle. So nothing is dropped for falling
// behind (which a slow device can do live), and the result is what a device
// that keeps up would show.

import { createTranscriber } from '../../src/audio/transcriber';
import { createFakeClock } from '../../src/session/testing/fake-clock';
import type { OnDeviceSegment, VoiceTurn } from '../../src/session/types';

export interface AudioSource {
  /** Media time of the first sample (the clip's start on the video's timeline). */
  start: number;
  sampleRate: number;
  /** Mono frames, in order. */
  audio: Iterable<Float32Array>;
}

export interface PlayDeps {
  /** Speech-to-text on 16 kHz mono samples. */
  transcribe(samples: Float32Array): Promise<string>;
  /** Voice separation; on from the first piece when given. */
  separate?(samples: Float32Array, time: number): Promise<VoiceTurn[]>;
}

export interface Played {
  segments: OnDeviceSegment[];
  /** Time spent waiting on speech-to-text and on voice separation. */
  transcribeMs: number;
  separateMs: number;
}

/** The transcriber ends a piece when frames stop for this long (its IDLE_MS, 1.5 s). */
const END_MS = 2_000;

/** Plays each source in turn on one transcriber (a jump between them is a seek, as on one page). */
export async function playThroughTranscriber(sources: AudioSource[], deps: PlayDeps): Promise<Played> {
  const clock = createFakeClock();
  const busy = new Set<Promise<unknown>>();
  const played: Played = { segments: [], transcribeMs: 0, separateMs: 0 };
  const timed = <A extends unknown[], R>(fn: (...args: A) => Promise<R>, add: (ms: number) => void) => (...args: A): Promise<R> => {
    const started = performance.now();
    const call = fn(...args).finally(() => {
      add(performance.now() - started);
      busy.delete(call);
    });
    busy.add(call);
    return call;
  };
  const separate = deps.separate;
  const transcriber = createTranscriber({
    clock,
    transcribe: timed((samples: Float32Array) => deps.transcribe(samples), (ms) => (played.transcribeMs += ms)),
    onSegment: (segment) => played.segments.push(segment),
    onFlowing: () => {},
    ...(separate ? { separate: timed((samples: Float32Array, time: number) => separate(samples, time), (ms) => (played.separateMs += ms)) } : {}),
  });
  transcriber.separateVoices(separate !== undefined);

  /** Until no model call is running, nor about to start. */
  async function idle() {
    for (;;) {
      await new Promise((resolve) => setImmediate(resolve));
      if (busy.size === 0) return;
      await Promise.allSettled([...busy]);
    }
  }

  for (const source of sources) {
    let time = source.start;
    for (const samples of source.audio) {
      transcriber.push({ sampleRate: source.sampleRate, samples, time });
      const seconds = samples.length / source.sampleRate;
      time += seconds;
      clock.advance(seconds * 1000);
      // The transcriber starts a piece's model calls a turn after cutting it.
      await idle();
    }
  }
  clock.advance(END_MS);
  await idle();
  transcriber.close();
  return played;
}
