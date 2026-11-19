// The voice separation gate's sessions and scoring.
//
// Sessions (eval/voices/sessions.json): four broadcasts from the evaluation
// set, each the clips of one broadcast played in order on one page (a jump
// between clips is a seek), with the reference speaker turns; and one whole
// debate (about 95 minutes), whose labelled stretches are its session's clips.
//
// Scoring, as in prototype/local-mode-eval (diarize.js `strict_acc`): 100 ms
// frames of reference speech; each voice is mapped to one speaker (greedily,
// by most shared frames, one voice per speaker), so a speaker split over two
// voices loses the second one's frames. The bar: at least 90% of speech on
// the right voice, in every session.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './cli';
import { EPSILON, percent } from './score';

export const VOICE_BAR = 0.9;
const FRAMES_PER_S = 10;
/** A voice counts toward a speaker's voices once it holds this much of their speech. */
const VOICE_MIN_S = 1;

export interface SpeakerTurn {
  speaker: string;
  start: number;
  end: number;
}

/** A stretch the voice separation gave a voice (media seconds). */
export interface VoicedTurn {
  voice: string;
  start: number;
  end: number;
}

export interface VoiceSession {
  id: string;
  clips: Array<{ clip: string; turns: SpeakerTurn[] }>;
  /** Every reference label in the session, sorted. */
  speakers: string[];
}

export interface FullDebate {
  id: string;
  url: string;
  start_s: number;
  end_s: number;
  /** Everyone who speaks in it. */
  speakers: string[];
  /** The labelled stretches: its reference session's turns. */
  turns: SpeakerTurn[];
}

export function loadVoiceSessions(): { sessions: VoiceSession[]; fullDebate: FullDebate } {
  const file = JSON.parse(readFileSync(join(ROOT, 'eval', 'voices', 'sessions.json'), 'utf8')) as {
    sessions: Array<Omit<VoiceSession, 'speakers'>>;
    fullDebate: Omit<FullDebate, 'turns'> & { reference: string };
  };
  const sessions = file.sessions.map((s) => ({ ...s, speakers: [...new Set(s.clips.flatMap((c) => c.turns.map((t) => t.speaker)))].sort() }));
  const { reference, ...debate } = file.fullDebate;
  const turns = sessions.find((s) => s.id === reference)?.clips.flatMap((c) => c.turns);
  if (!turns) throw new Error(`eval/voices/sessions.json: no session "${reference}" for the whole debate`);
  return { sessions, fullDebate: { ...debate, turns } };
}

/**
 * What voice separation said, stretch by stretch, with later merges applied to
 * earlier turns: the voices the viewer ends up seeing.
 */
export function finalVoices(results: Array<{ turns: VoicedTurn[]; merged: Array<{ voice: string; into: string }> }>): VoicedTurn[] {
  const into = new Map<string, string>();
  const find = (voice: string): string => {
    const next = into.get(voice);
    return next === undefined ? voice : find(next);
  };
  for (const { merged } of results) for (const m of merged) if (find(m.voice) !== find(m.into)) into.set(find(m.voice), find(m.into));
  return results.flatMap((r) => r.turns).map((t) => ({ ...t, voice: find(t.voice) }));
}

export interface VoiceScore {
  /** Seconds of reference speech scored. */
  speech: number;
  /** Share of it on its speaker's voice. */
  right: number;
  /** Share of it given no voice. */
  missed: number;
  /** Voices made (over everything separated, labelled or not). */
  voices: number;
  /** Per reference speaker: the voices holding at least 1 s of their speech. */
  speakers: Array<{ speaker: string; seconds: number; voices: number }>;
  /** Voice → the speaker it was mapped to. */
  mapping: Record<string, string>;
}

const frames = (start: number, end: number) => {
  const out: number[] = [];
  for (let i = Math.round(start * FRAMES_PER_S); i < Math.round(end * FRAMES_PER_S); i++) out.push(i);
  return out;
};

export function scoreVoices(reference: SpeakerTurn[], voiced: VoicedTurn[]): VoiceScore {
  const speakerAt = new Map<number, string>();
  for (const t of reference) for (const f of frames(t.start, t.end)) speakerAt.set(f, t.speaker);
  const voiceAt = new Map<number, string>();
  for (const t of voiced) for (const f of frames(t.start, t.end)) if (speakerAt.has(f)) voiceAt.set(f, t.voice);

  /** voice → speaker → frames */
  const shared = new Map<string, Map<string, number>>();
  for (const [f, voice] of voiceAt) {
    const row = shared.get(voice) ?? new Map<string, number>();
    const speaker = speakerAt.get(f)!;
    row.set(speaker, (row.get(speaker) ?? 0) + 1);
    shared.set(voice, row);
  }
  const pairs = [...shared].flatMap(([voice, row]) => [...row].map(([speaker, n]) => ({ voice, speaker, n }))).sort((a, b) => b.n - a.n);
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  for (const { voice, speaker } of pairs) {
    if (voice in mapping || taken.has(speaker)) continue;
    mapping[voice] = speaker;
    taken.add(speaker);
  }

  const speech = speakerAt.size;
  let right = 0;
  for (const [f, voice] of voiceAt) if (mapping[voice] === speakerAt.get(f)) right++;
  const speakers = [...new Set(reference.map((t) => t.speaker))].sort().map((speaker) => ({
    speaker,
    seconds: [...speakerAt.values()].filter((s) => s === speaker).length / FRAMES_PER_S,
    voices: [...shared.values()].filter((row) => (row.get(speaker) ?? 0) >= VOICE_MIN_S * FRAMES_PER_S).length,
  }));
  return {
    speech: speech / FRAMES_PER_S,
    right: speech === 0 ? 0 : right / speech,
    missed: speech === 0 ? 0 : (speech - voiceAt.size) / speech,
    voices: new Set(voiced.map((t) => t.voice)).size,
    speakers,
    mapping,
  };
}

export interface ScoredSession {
  id: string;
  score: VoiceScore;
  /** The whole debate. */
  full?: boolean;
  /** Audio played, in minutes. */
  minutes?: number;
  /** How many people speak in it, where more speak than are labelled. */
  speakers?: number;
}

export interface VoiceGateScore {
  sessions: Array<ScoredSession & { pass: boolean }>;
  worst: ScoredSession | undefined;
  pass: boolean;
}

export function scoreVoiceGate(sessions: ScoredSession[]): VoiceGateScore {
  const checked = sessions.map((s) => ({ ...s, pass: s.score.right >= VOICE_BAR - EPSILON }));
  const worst = [...checked].sort((a, b) => a.score.right - b.score.right)[0];
  return { sessions: checked, worst, pass: checked.length > 0 && checked.every((s) => s.pass) };
}

export function formatVoiceReport(title: string, gate: VoiceGateScore): string {
  const name = (s: ScoredSession) => `${s.id}${s.full ? ` (whole debate, ${Math.round(s.minutes ?? 0)} min)` : ''}`;
  const width = Math.max(...gate.sessions.map((s) => name(s).length), 10) + 2;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [
    `Voice separation gate: ${title}`,
    `${gate.sessions.length} sessions; the share of each one's labelled speech on the right voice (each voice counts for one speaker)`,
    '',
    ...gate.sessions.map((s) => `  ${s.pass ? 'PASS' : 'FAIL'}  ${name(s).padEnd(width)}${percent(s.score.right).padEnd(10)}target ≥ ${percent(VOICE_BAR)}`),
    '',
    `Gate: ${gate.pass ? 'PASS' : 'FAIL'}`,
    '',
    ...gate.sessions.flatMap((s) => [
      `${name(s)}: ${plural(s.score.voices, 'voice')} made for ${plural(s.speakers ?? s.score.speakers.length, 'speaker')}; ` +
        `${s.score.speech.toFixed(0)} s of labelled speech, ${percent(s.score.missed)} given no voice${s.minutes ? `, ${s.minutes.toFixed(1)} min played` : ''}`,
      ...s.score.speakers.map((p) => `  ${p.speaker.padEnd(20)}${plural(p.voices, 'voice').padEnd(10)}${p.seconds.toFixed(0)} s`),
    ]),
  ].join('\n');
}
