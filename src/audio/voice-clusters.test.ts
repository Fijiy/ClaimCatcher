// Online voice clustering: each speech segment's voiceprint (a WeSpeaker
// embedding, made up here) joins the voice it sounds most like, or starts a
// new one; voices that turn out alike are merged. The thresholds are tuned by
// the quality gate (docs/quality-gate.md), not pinned here: these voiceprints
// are clearly the same voice (cosine 0.95 or more) or clearly different
// (cosine near 0), so any sensible thresholds give the same answers.

import { describe, expect, it } from 'vitest';
import { createVoiceClusters, type VoiceSegment } from './voice-clusters';

const DIM = 256;

/** A unit vector along axis `i`. */
const axis = (i: number) => {
  const v = new Float32Array(DIM);
  v[i] = 1;
  return v;
};

/** A unit vector at `degrees` from axis `i` towards axis `j` (in their plane). */
const turned = (i: number, j: number, degrees: number) => {
  const v = new Float32Array(DIM);
  v[i] = Math.cos((degrees * Math.PI) / 180);
  v[j] = Math.sin((degrees * Math.PI) / 180);
  return v;
};

/** A unit vector with cosine `cos` to axis `i`, leaning towards axis `j`. */
const near = (i: number, cos: number, j: number) => {
  const v = new Float32Array(DIM);
  v[i] = cos;
  v[j] = Math.sqrt(1 - cos * cos);
  return v;
};

const seg = (start: number, end: number, embedding: Float32Array, overlap = false): VoiceSegment => ({ start, end, embedding, ...(overlap ? { overlap } : {}) });

function setup() {
  let n = 0;
  return createVoiceClusters({ newId: () => `v${++n}` });
}

describe('voice clusters', () => {
  it('tells two different voices apart, and keeps each one across windows', () => {
    const voices = setup();
    const first = voices.add([seg(0, 4, axis(0)), seg(4, 9, axis(1))]);
    const second = voices.add([seg(10, 13, near(0, 0.95, 5)), seg(13, 19, near(1, 0.95, 6))]);

    expect(first.turns.map((t) => t.voice)).toEqual(['v1', 'v2']);
    expect(second.turns).toEqual([
      { start: 10, end: 13, voice: 'v1' },
      { start: 13, end: 19, voice: 'v2' },
    ]);
  });

  it('starts a new voice for a clearly different one, not for the same voice heard again', () => {
    const voices = setup();
    voices.add([seg(0, 5, axis(0))]);
    const same = voices.add([seg(5, 9, near(0, 0.95, 1))]);
    const different = voices.add([seg(9, 13, near(0, 0.05, 2))]);

    expect(same.turns[0]?.voice).toBe('v1');
    expect(different.turns[0]?.voice).toBe('v2');
  });

  it('never starts a voice from a very short segment: it joins the closest one', () => {
    const voices = setup();
    voices.add([seg(0, 5, axis(0)), seg(5, 10, axis(1))]);
    // Unlike either voice, but a moment long.
    const short = voices.add([seg(10, 10.3, near(1, 0.1, 3))]);

    expect(short.turns[0]?.voice).toBe('v2');
  });

  it('merges a voice into the older one when, heard for longer, their voiceprints come out alike', () => {
    const voices = setup();
    voices.add([seg(0, 5, axis(0))]);
    const other = voices.add([seg(5, 10, axis(1))]);
    expect(other.turns[0]?.voice).toBe('v2');

    // v1's voiceprint drifts towards v2's, a little with each long stretch,
    // each step clearly the voice it was: in the end they are one voice.
    const merged: Array<{ voice: string; into: string }> = [];
    let at = 10;
    let last: string | undefined;
    for (const degrees of [15, 30, 45, 60, 60, 60]) {
      const result = voices.add([seg(at, at + 30, turned(0, 1, degrees))]);
      merged.push(...result.merged);
      last = result.turns[0]?.voice;
      at += 30;
    }

    expect(merged).toEqual([{ voice: 'v2', into: 'v1' }]);
    expect(last).toBe('v1');
    expect(voices.add([seg(at, at + 5, axis(1))]).turns[0]?.voice).toBe('v1');
  });

  it('keeps two clearly different voices apart over a long conversation', () => {
    const voices = setup();
    const merged: Array<{ voice: string; into: string }> = [];
    const heard: string[] = [];
    for (let turn = 0; turn < 40; turn++) {
      const result = voices.add([seg(turn * 10, turn * 10 + 10, turn % 2 ? near(1, 0.95, 2 + turn) : near(0, 0.95, 2 + turn))]);
      merged.push(...result.merged);
      heard.push(result.turns[0]!.voice);
    }

    expect(merged).toEqual([]);
    expect(new Set(heard.filter((_, i) => i % 2 === 0))).toEqual(new Set(['v1']));
    expect(new Set(heard.filter((_, i) => i % 2 === 1))).toEqual(new Set(['v2']));
  });

  it('gives speech of two voices at once to the voice it sounds most like, but never starts a voice from it', () => {
    const voices = setup();
    const first = voices.add([seg(0, 4, axis(0), true)]);
    expect(first.turns).toEqual([]);

    voices.add([seg(4, 9, axis(0))]);
    const crosstalk = voices.add([seg(9, 14, near(0, 0.95, 1), true), seg(14, 19, axis(2), true)]);
    expect(crosstalk.turns).toEqual([
      { start: 9, end: 14, voice: 'v1' },
      { start: 14, end: 19, voice: 'v1' },
    ]);
    expect(voices.add([seg(19, 23, axis(2))]).turns[0]?.voice).toBe('v2');
  });

  it('keeps speech of two voices at once out of the voiceprints: however much crosstalk, voices keep apart', () => {
    const voices = setup();
    voices.add([seg(0, 5, axis(0)), seg(5, 10, axis(1))]);
    // Long stretches of both at once, a little nearer v1.
    const merged: Array<{ voice: string; into: string }> = [];
    for (let at = 10; at < 310; at += 30) merged.push(...voices.add([seg(at, at + 30, turned(0, 1, 40), true)]).merged);

    expect(merged).toEqual([]);
    expect(voices.add([seg(310, 315, axis(1))]).turns[0]?.voice).toBe('v2');
  });

  it('merges two voices on request (the viewer gave them one name)', () => {
    const voices = setup();
    voices.add([seg(0, 5, axis(0)), seg(5, 10, axis(1))]);
    voices.merge('v2', 'v1');

    expect(voices.add([seg(10, 14, axis(1))]).turns[0]?.voice).toBe('v1');
  });
});
