import { describe, expect, it } from 'vitest';
import { playThroughTranscriber } from './play';

const RATE = 48_000;

/** [seconds, loud?] parts at 48 kHz: sound as a 200 Hz tone, silence as zeros, in 250 ms frames. */
function audio(...parts: Array<[number, boolean]>): Float32Array[] {
  const total = parts.reduce((s, [secs]) => s + secs, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let at = 0;
  for (const [secs, loud] of parts) {
    const n = Math.round(secs * RATE);
    if (loud) for (let i = 0; i < n; i++) out[at + i] = 0.3 * Math.sin((2 * Math.PI * 200 * (at + i)) / RATE);
    at += n;
  }
  const frames: Float32Array[] = [];
  for (let i = 0; i < out.length; i += RATE / 4) frames.push(out.slice(i, i + RATE / 4));
  return frames;
}

const slowly = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 2));

describe('playing clip audio through the shipped transcriber', () => {
  it('transcribes every piece, however slow the model, and keeps their order', async () => {
    // Eight 6 s stretches of sound, each followed by a 1 s pause: the transcriber
    // cuts eight pieces, more than it lets wait for a slow model live.
    const parts: Array<[number, boolean]> = [];
    for (let i = 0; i < 8; i++) parts.push([6, true], [1, false]);
    let calls = 0;
    const played = await playThroughTranscriber([{ start: 100, sampleRate: RATE, audio: audio(...parts) }], {
      transcribe: () => slowly(`piece ${++calls}`),
    });
    expect(played.segments.map((s) => s.text)).toEqual(Array.from({ length: 8 }, (_, i) => `piece ${i + 1}`));
    expect(played.segments[0]!.start).toBeCloseTo(100, 0);
    expect(played.transcribeMs).toBeGreaterThan(0);
  });

  it('separates voices on every piece at its media time, across a seek to the next clip', async () => {
    const times: number[] = [];
    const played = await playThroughTranscriber(
      [
        { start: 200, sampleRate: RATE, audio: audio([6, true], [1, false]) },
        { start: 1750, sampleRate: RATE, audio: audio([6, true], [1, false]) },
      ],
      {
        transcribe: async () => '',
        separate: (_samples, time) => {
          times.push(time);
          return slowly([]);
        },
      },
    );
    expect(times).toHaveLength(2);
    expect(times[0]).toBeCloseTo(200, 0);
    expect(times[1]).toBeCloseTo(1750, 0);
    expect(played.segments).toEqual([]);
  });
});
