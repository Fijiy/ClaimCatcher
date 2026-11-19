import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finalVoices, formatVoiceReport, loadVoiceSessions, scoreVoiceGate, scoreVoices, type SpeakerTurn } from './voices';

// Reference: A speaks 0–10 s, B 10–20 s, A 20–30 s (media seconds).
const REFERENCE: SpeakerTurn[] = [
  { speaker: 'A', start: 0, end: 10 },
  { speaker: 'B', start: 10, end: 20 },
  { speaker: 'A', start: 20, end: 30 },
];

describe('scoring voice separation against speaker turns', () => {
  it('measures the share of speech on the right voice, in 100 ms frames, mapping each voice to one speaker', () => {
    const score = scoreVoices(REFERENCE, [
      { voice: 'v1', start: 0, end: 10 },
      { voice: 'v2', start: 10, end: 17 },
      // 3 s of B heard as A's voice.
      { voice: 'v1', start: 17, end: 30 },
    ]);
    expect(score.speech).toBeCloseTo(30);
    expect(score.right).toBeCloseTo(27 / 30);
    expect(score.missed).toBe(0);
    expect(score.voices).toBe(2);
    expect(score.speakers.map((s) => [s.speaker, s.voices])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });

  it("counts a speaker split over two voices against it: each voice is one speaker's", () => {
    const score = scoreVoices(REFERENCE, [
      { voice: 'v1', start: 0, end: 10 },
      { voice: 'v2', start: 10, end: 20 },
      { voice: 'v3', start: 20, end: 30 },
    ]);
    expect(score.right).toBeCloseTo(20 / 30);
    expect(score.speakers.find((s) => s.speaker === 'A')!.voices).toBe(2);
    expect(score.voices).toBe(3);
  });

  it('counts speech given no voice as missed, and ignores voices outside the labelled stretches except in the count of voices', () => {
    const score = scoreVoices(REFERENCE, [
      { voice: 'v1', start: 0, end: 5 },
      { voice: 'v2', start: 10, end: 20 },
      { voice: 'v1', start: 20, end: 30 },
      { voice: 'v3', start: 100, end: 160 },
    ]);
    expect(score.right).toBeCloseTo(25 / 30);
    expect(score.missed).toBeCloseTo(5 / 30);
    expect(score.voices).toBe(3);
  });

  it('applies later merges to earlier turns, as the session relabels its lines', () => {
    const turns = finalVoices([
      { turns: [{ voice: 'v1', start: 0, end: 10 }], merged: [] },
      { turns: [{ voice: 'v2', start: 10, end: 20 }], merged: [] },
      { turns: [{ voice: 'v3', start: 20, end: 30 }], merged: [{ voice: 'v1', into: 'v3' }] },
      { turns: [{ voice: 'v3', start: 30, end: 31 }], merged: [{ voice: 'v3', into: 'v2' }] },
    ]);
    expect(turns.map((t) => t.voice)).toEqual(['v2', 'v2', 'v2', 'v2']);
  });
});

describe('the voice gate', () => {
  const good = scoreVoices(REFERENCE, [
    { voice: 'v1', start: 0, end: 10 },
    { voice: 'v2', start: 10, end: 20 },
    { voice: 'v1', start: 20, end: 29 },
  ]);
  const poor = scoreVoices(REFERENCE, [{ voice: 'v1', start: 0, end: 30 }]);

  it('passes when every session has at least 90% of its speech on the right voice', () => {
    expect(good.right).toBeCloseTo(29 / 30);
    expect(scoreVoiceGate([{ id: 'cnn', score: good }]).pass).toBe(true);
    const gate = scoreVoiceGate([
      { id: 'cnn', score: good },
      { id: 'abc-2024-debate', score: poor, full: true },
    ]);
    expect(gate.pass).toBe(false);
    expect(gate.worst).toMatchObject({ id: 'abc-2024-debate' });
  });

  it('prints each session with PASS or FAIL, and voices per speaker', () => {
    const report = formatVoiceReport('pyannote + WeSpeaker', scoreVoiceGate([
      { id: 'cnn', score: good, minutes: 3 },
      { id: 'abc-2024-debate', score: poor, full: true, minutes: 95, speakers: 4 },
    ]));
    expect(report).toMatch(/PASS {2}cnn\s+96\.7%/);
    expect(report).toMatch(/FAIL {2}abc-2024-debate \(whole debate, 95 min\)\s+66\.7%/);
    expect(report).toContain('Gate: FAIL');
    expect(report).toMatch(/A\s+1 voice/);
    expect(report).toContain('1 voice made for 4 speakers');
  });
});

describe("the voice gate's sessions", () => {
  it('are four broadcasts from the evaluation set, and one whole debate scored on its labelled stretches', () => {
    const { sessions, fullDebate } = loadVoiceSessions();
    expect(sessions.map((s) => s.id)).toEqual(['cnn', 'abc', 'cbs', 'pmqs']);
    expect(sessions.find((s) => s.id === 'cbs')!.speakers).toEqual(['JDV', 'MB', 'NO', 'TW']);
    expect(fullDebate.end_s - fullDebate.start_s).toBeGreaterThan(90 * 60);
    expect(fullDebate.turns).toEqual(sessions.find((s) => s.id === 'abc')!.clips.flatMap((c) => c.turns));
  });

  it("label only audio that is played: each turn lies inside its clip's window", () => {
    const windows = new Map(
      (JSON.parse(readFileSync(new URL('../../eval/clips.json', import.meta.url), 'utf8')) as Array<{ id: string; video: { start_s: number; end_s: number } }>).map((c) => [c.id, c.video]),
    );
    for (const session of loadVoiceSessions().sessions) {
      for (const { clip, turns } of session.clips) {
        const window = windows.get(clip)!;
        for (const t of turns) expect([t.start >= window.start_s, t.end <= window.end_s, t.end > t.start]).toEqual([true, true, true]);
      }
    }
  });
});
