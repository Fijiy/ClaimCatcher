import { describe, expect, it } from 'vitest';
import { fromWire, toWire } from './wire';

describe('model task data on the quality gate wire', () => {
  it('carries audio and voiceprints through JSON exactly, and leaves the rest as is', () => {
    const audio = new Float32Array([0, 0.5, -1, 1e-7, Math.PI]);
    const output = { segments: [{ start: 1.25, end: 3, embedding: audio.subarray(1, 4) }], text: 'Ask not', done: true };
    const crossed = fromWire(JSON.parse(JSON.stringify(toWire(output))));
    expect(crossed).toEqual({ segments: [{ start: 1.25, end: 3, embedding: new Float32Array([0.5, -1, 1e-7]) }], text: 'Ask not', done: true });
    expect((crossed as typeof output).segments[0]!.embedding).toBeInstanceOf(Float32Array);
  });
});
