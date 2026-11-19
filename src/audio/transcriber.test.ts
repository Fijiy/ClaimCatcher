// The transcriber turns the tab's audio into on-device transcript segments:
// it cuts the audio at pauses, runs speech-to-text on each piece (a fake
// here), and says whether audio is flowing. Tests feed it PCM frames as a
// page would (48 kHz, 100 ms at a time) and a fake clock.

import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../session/testing/fake-clock';
import type { OnDeviceSegment, VoiceTurn } from '../session/types';
import { createTranscriber, type PcmFrame } from './transcriber';

const RATE = 48_000;
const FRAME_S = 0.1;

/** A 48 kHz script: [seconds, loud?] pieces, sound as a 200 Hz tone, silence as zeros. */
function script(...parts: Array<[number, boolean]>): Float32Array {
  const total = parts.reduce((s, [secs]) => s + secs, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let at = 0;
  for (const [secs, loud] of parts) {
    const n = Math.round(secs * RATE);
    if (loud) for (let i = 0; i < n; i++) out[at + i] = 0.3 * Math.sin((2 * Math.PI * 200 * (at + i)) / RATE);
    at += n;
  }
  return out;
}

function setup() {
  const clock = createFakeClock();
  const segments: OnDeviceSegment[] = [];
  const flowing: boolean[] = [];
  /** Seconds of audio reported as run through speech-to-text, piece by piece. */
  const transcribed: number[] = [];
  /** The length, in seconds, of each piece speech-to-text was given. */
  const given: number[] = [];
  let pending: Array<() => void> = [];
  let hold = false;
  /** Each stretch voice separation was given: [media start, seconds]. */
  const separated: Array<[number, number]> = [];
  /** Who speaks when, as the fake voice separation hears it. */
  let speakers: VoiceTurn[] = [];
  const transcriber = createTranscriber({
    clock,
    transcribe: (samples) => {
      given.push(samples.length / 16_000);
      const text = `words ${given.length}`;
      if (!hold) return Promise.resolve(text);
      return new Promise((resolve) => pending.push(() => resolve(text)));
    },
    onSegment: (segment) => segments.push(segment),
    onFlowing: (now) => flowing.push(now),
    onTranscribed: (seconds) => transcribed.push(seconds),
    separate: (samples, time) => {
      const end = time + samples.length / 16_000;
      separated.push([Math.round(time * 10) / 10, Math.round((samples.length / 16_000) * 10) / 10]);
      return Promise.resolve(
        speakers.filter((t) => t.end > time && t.start < end).map((t) => ({ ...t, start: Math.max(t.start, time), end: Math.min(t.end, end) })),
      );
    },
  });

  /** Plays samples in real time from media time `from`, 100 ms per frame. */
  async function play(samples: Float32Array, from = 0) {
    const step = Math.round(FRAME_S * RATE);
    for (let at = 0; at < samples.length; at += step) {
      const frame: PcmFrame = { sampleRate: RATE, samples: samples.slice(at, at + step), time: from + at / RATE };
      transcriber.push(frame);
      clock.advance(FRAME_S * 1000);
    }
    await settle();
  }
  return {
    clock,
    transcriber,
    segments,
    flowing,
    given,
    transcribed,
    play,
    separated,
    speak: (turns: VoiceTurn[]) => (speakers = turns),
    holdTranscripts: () => (hold = true),
    releaseTranscripts: async () => {
      hold = false;
      for (const done of pending.splice(0)) done();
      await settle();
    },
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const round = (s: OnDeviceSegment) => ({ ...s, start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10 });

describe('transcriber', () => {
  it('does not cut at a pause before a piece is 5 s long', async () => {
    const { play, segments } = setup();

    await play(script([2, true], [0.8, false], [2, true], [1, false]));

    expect(segments.map(round)).toEqual([{ start: 0, end: 4.8, text: 'words 1' }]);
  });

  it('cuts speech at pauses and gives each piece the media times its sound starts and ends', async () => {
    const { play, segments } = setup();

    await play(script([1, false], [5, true], [1, false], [4.5, true], [2, false]), 30);

    expect(segments.map(round)).toEqual([
      { start: 31, end: 36, text: 'words 1' },
      { start: 37, end: 41.5, text: 'words 2' },
    ]);
  });

  it('never runs speech-to-text on silence', async () => {
    const { play, segments, given } = setup();

    await play(script([20, false]));

    expect(given).toEqual([]);
    expect(segments).toEqual([]);
  });

  it('says audio is flowing while there is sound, and not after 3 s of silence or when frames stop coming', async () => {
    const { play, flowing, clock } = setup();

    await play(script([2, false]));
    expect(flowing).toEqual([]);
    await play(script([3, true], [2, false]), 2);
    expect(flowing).toEqual([true]);
    await play(script([1.5, false]), 7);
    expect(flowing).toEqual([true, false]);

    await play(script([1, true]), 8.5);
    expect(flowing).toEqual([true, false, true]);
    clock.advance(2_000); // paused: no more frames
    expect(flowing).toEqual([true, false, true, false]);
  });

  it('cuts speech with no pause into pieces of at most 15 s, at its quietest moment', async () => {
    const { play, segments, given } = setup();
    // Steady speech with one dip at 12 s.
    await play(script([12, true], [0.2, false], [12, true], [1, false]));

    expect(given.every((s) => s <= 15)).toBe(true);
    expect(segments.map(round)[0]).toEqual({ start: 0, end: 12, text: 'words 1' });
    expect(segments.map(round).at(-1)?.end).toBe(24.2);
  });

  it('flushes what it has when frames stop, and pads a piece shorter than 1 s', async () => {
    const { play, clock, segments, given } = setup();

    await play(script([0.5, true]), 3);
    clock.advance(2_000);
    await settle();

    expect(segments.map(round)).toEqual([{ start: 3, end: 3.5, text: 'words 1' }]);
    expect(given[0]).toBeGreaterThanOrEqual(1);
  });

  it('starts a new piece when the video jumps (a seek)', async () => {
    const { play, clock, segments } = setup();

    await play(script([3, true]), 10);
    await play(script([3, true]), 100);
    clock.advance(2_000);
    await settle();

    expect(segments.map(round)).toEqual([
      { start: 10, end: 13, text: 'words 1' },
      { start: 100, end: 103, text: 'words 2' },
    ]);
  });

  it('transcribes one piece at a time, in order, and drops nothing after closing', async () => {
    const { play, segments, holdTranscripts, releaseTranscripts, transcriber } = setup();
    holdTranscripts();

    await play(script([5.5, true], [1, false], [5.5, true], [1, false]));
    expect(segments).toEqual([]);
    await releaseTranscripts();
    expect(segments.map((s) => s.text)).toEqual(['words 1', 'words 2']);

    transcriber.close();
    await play(script([5.5, true], [1, false]), 20);
    expect(segments).toHaveLength(2);
  });
});

describe('transcriber: what speech-to-text ran on', () => {
  it('reports the seconds of audio each piece ran through speech-to-text, words or not', async () => {
    const { play, given, transcribed, transcriber } = setup();
    await play(script([6, true], [1, false], [6, true], [2, false]));
    transcriber.close();

    expect(given.length).toBeGreaterThanOrEqual(2);
    expect(transcribed).toEqual(given);
  });

  it('reports nothing for silence, which never reaches speech-to-text', async () => {
    const { play, transcribed } = setup();
    await play(script([8, false]));
    expect(transcribed).toEqual([]);
  });
});

describe('transcriber: voice separation', () => {
  it('runs only when switched on, and tags each segment with the voice that spoke most of it', async () => {
    const { play, segments, separated, speak, transcriber } = setup();
    speak([
      { start: 0, end: 4, voice: 'v1' },
      { start: 4, end: 12, voice: 'v2' },
    ]);

    await play(script([5.5, true], [1, false]));
    expect(separated).toEqual([]);
    expect(segments[0]?.voice).toBeUndefined();

    transcriber.separateVoices(true);
    await settle();
    separated.length = 0;
    await play(script([5.5, true], [1, false]), 6.5);

    // The piece starts with a moment of the pause before it (6.2 s).
    expect(separated.map(([start]) => start)).toEqual([6.2]);
    expect(segments.map(round)[1]).toEqual({ start: 6.5, end: 12, text: 'words 2', voice: 'v2' });
  });

  it('when switched on, separates the last 30 s it already transcribed, so those lines get voices too', async () => {
    const { play, separated, transcriber, given } = setup();
    // Four pieces of 5.5 s of sound (0-25.5 s), then one at 40-45.5 s: by then the first two ended more than 30 s before.
    await play(script([5.5, true], [1, false], [5.5, true], [1, false], [5.5, true], [1, false], [5.5, true], [1, false]));
    await play(script([5.5, true], [1, false]), 40);
    const transcribed = given.length;

    transcriber.separateVoices(true);
    await settle();

    // Each piece starts with a moment of the pause before it.
    expect(separated.map(([start]) => start)).toEqual([12.7, 19.2, 40]);
    // Speech-to-text isn't run again.
    expect(given.length).toBe(transcribed);
  });

  it('gives a segment no voice if voice separation fails there', async () => {
    const clock = createFakeClock();
    const segments: OnDeviceSegment[] = [];
    const transcriber = createTranscriber({
      clock,
      transcribe: () => Promise.resolve('words'),
      onSegment: (segment) => segments.push(segment),
      onFlowing: () => {},
      separate: () => Promise.reject(new Error('no model')),
    });
    transcriber.separateVoices(true);
    const samples = script([5.5, true], [1, false]);
    for (let at = 0; at < samples.length; at += 4800) {
      transcriber.push({ sampleRate: RATE, samples: samples.slice(at, at + 4800), time: at / RATE });
      clock.advance(100);
    }
    await settle();

    expect(segments.map(round)).toEqual([{ start: 0, end: 5.5, text: 'words' }]);
  });
});
