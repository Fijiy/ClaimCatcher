import { describe, expect, it } from 'vitest';
import { createResampler, decodePcm, encodePcm, MODEL_RATE } from './pcm';

const sine = (rate: number, hz: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate));

/** Upward zero crossings per second: the tone's frequency. */
function frequency(samples: Float32Array, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1]! < 0 && samples[i]! >= 0) crossings++;
  return crossings / (samples.length / rate);
}

const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

describe('PCM over a message', () => {
  it('survives encoding to 16-bit text and back, within 16-bit precision', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 0.123456, 2, -2]);
    const back = decodePcm(encodePcm(samples));
    expect(typeof encodePcm(samples)).toBe('string');
    expect(Array.from(back).map((x) => Math.round(x * 1000) / 1000)).toEqual([0, 0.5, -0.5, 1, -1, 0.123, 1, -1]);
  });
});

describe('resampling to the models’ 16 kHz', () => {
  /** Level of the output's middle, away from the filter's start-up. */
  const steadyRms = (out: Float32Array) => rms(out.subarray(200, out.length - 200));

  it('turns 48 kHz into 16 kHz, keeping pitch and level', () => {
    const out = createResampler(48_000).push(sine(48_000, 440, 1));
    expect(MODEL_RATE).toBe(16_000);
    // All but the last few milliseconds, which wait for the next frame.
    expect(out.length).toBeGreaterThan(15_900);
    expect(out.length).toBeLessThanOrEqual(16_000);
    expect(frequency(out, 16_000)).toBeCloseTo(440, -1);
    expect(steadyRms(out)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });

  it('turns 44.1 kHz into 16 kHz', () => {
    const out = createResampler(44_100).push(sine(44_100, 300, 2));
    expect(out.length).toBeGreaterThan(31_900);
    expect(out.length).toBeLessThanOrEqual(32_000);
    expect(frequency(out, 16_000)).toBeCloseTo(300, -1);
  });

  it.each([48_000, 44_100])('keeps the speech band at full level from %i Hz', (rate) => {
    for (const hz of [100, 1_000, 3_000, 6_000]) {
      const out = createResampler(rate).push(sine(rate, hz, 1));
      expect(steadyRms(out) / (0.5 / Math.SQRT2), `${hz} Hz`).toBeCloseTo(1, 2);
    }
  });

  it.each([48_000, 44_100])('removes what 16 kHz cannot hold (above 8 kHz) from %i Hz, instead of folding it into the speech band', (rate) => {
    // Each would fold down to a tone below 8 kHz. At least 60 dB down.
    for (const hz of [8_200, 9_000, 12_000, 15_000, 20_000]) {
      const out = createResampler(rate).push(sine(rate, hz, 1));
      expect(steadyRms(out) / (0.5 / Math.SQRT2), `${hz} Hz`).toBeLessThan(1e-3);
    }
  });

  it.each([48_000, 44_100])('keeps media times: a click 0.1 s into %i Hz audio is at 16 kHz sample 1,600', (rate) => {
    const input = new Float32Array(rate / 2);
    input[rate / 10] = 1;
    const out = createResampler(rate).push(input);
    let peak = 0;
    for (let i = 1; i < out.length; i++) if (out[i]! > out[peak]!) peak = i;
    expect(peak).toBe(1_600);
  });

  it.each([48_000, 44_100])('gives the same samples from %i Hz whether the audio comes in one piece or many', (rate) => {
    const input = Float32Array.from(sine(rate, 250, 1), (x, i) => x + 0.3 * Math.sin(i * 0.37) + 0.1 * Math.sin(i * 2.1));
    const whole = createResampler(rate).push(input);
    // Uneven pieces, from a single sample up to a few thousand, as a worklet or a tab might send them.
    const sizes = [1, 7, 128, 441, 1, 3_000, 2, 960, 13];
    const pieces = createResampler(rate);
    const parts: number[] = [];
    for (let at = 0, n = 0; at < input.length; at += sizes[n++ % sizes.length]!) {
      parts.push(...pieces.push(input.subarray(at, at + sizes[n % sizes.length]!)));
    }
    expect(parts.length).toBe(whole.length);
    parts.forEach((x, i) => expect(x).toBeCloseTo(whole[i]!, 6));
  });
});
