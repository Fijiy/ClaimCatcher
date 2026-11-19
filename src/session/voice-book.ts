// The session's record of the voices voice separation told apart on this page
// (GLOSSARY: voice): which voice spoke when, their letters ("Voice A"), the
// names the viewer gave them, and which ones are the same voice.
//
// Voice ids come from the model worker and are opaque. A voice gets its
// letter the first time a transcript line is tagged with it. Two voices are
// merged when the viewer gives them the same name, or when voice separation
// itself finds them alike; a merged voice points at the one it joined
// (`sameAs`), and everything about it is read from that one.
//
// Caption lines have no voice of their own: they get the voice that spoke at
// their time, once that stretch of audio has been separated (`covered`). A
// check can wait for that (`waitFor`), up to VOICE_WAIT_MS.

import type { Clock, Voice, VoiceId, VoiceTurn } from './types';

/** How long a check waits for its line's audio to be separated before going on without a voice. */
export const VOICE_WAIT_MS = 15_000;
/** A line this close to a turn (in seconds) belongs to it: captions and turns don't line up exactly. */
const NEAR_S = 1.5;
/** How many turns and separated stretches are kept, newest first (about half an hour of debate). */
const KEPT = 600;

export interface VoiceBook {
  /** The voice a line said by `voice` is shown as (merged voices resolved); gives it a letter if it's new. */
  tag(voice: VoiceId): VoiceId;
  /** Whether the audio at `time` (media seconds) has been separated. */
  covered(time: number): boolean;
  /** The voice that spoke at `time`, if the audio there was separated and someone spoke. Gives it a letter. */
  at(time: number): VoiceId | undefined;
  /** Resolves once the audio at `time` is separated, or after VOICE_WAIT_MS. */
  waitFor(time: number): Promise<void>;
  /** Voice separation's result for a stretch of audio: its turns, and voices it found to be the same. */
  record(span: { start: number; end: number }, turns: VoiceTurn[], merged: Array<{ voice: VoiceId; into: VoiceId }>): void;
  /** The voice everything about `voice` is read from (after merges). */
  get(voice: VoiceId): Voice | undefined;
  /** Whether two voices are (now) the same. */
  same(a: VoiceId, b: VoiceId): boolean;
  /** The viewer named a voice. A voice already given that name absorbs it. */
  name(voice: VoiceId, name: string): void;
  skip(voice: VoiceId): void;
  /** "Who is this?" is being asked for this voice (or is about to be). */
  asking(voice: VoiceId): boolean;
  setAsking(voice: VoiceId, asking: boolean): void;
  /** Another page, or Clear now: forget every voice. */
  reset(): void;
}

export function createVoiceBook(clock: Clock, changed: (voice: Voice) => void): VoiceBook {
  /** Voices with a letter, by id. */
  let voices = new Map<VoiceId, Voice>();
  /** Merges, for voices with and without a letter. */
  let sameAs = new Map<VoiceId, VoiceId>();
  let asking = new Set<VoiceId>();
  let turns: VoiceTurn[] = [];
  let spans: Array<{ start: number; end: number }> = [];
  let waiting: Array<{ time: number; done: () => void }> = [];

  const resolve = (id: VoiceId): VoiceId => {
    const seen = new Set<VoiceId>();
    let at = id;
    while (sameAs.has(at) && !seen.has(at)) {
      seen.add(at);
      at = sameAs.get(at)!;
    }
    return at;
  };

  function update(voice: Voice) {
    voices.set(voice.id, voice);
    changed(voice);
  }

  function tag(voice: VoiceId): VoiceId {
    const id = resolve(voice);
    if (!voices.has(id)) update({ id, label: `Voice ${letters(voices.size)}` });
    return id;
  }

  function covered(time: number): boolean {
    return spans.some((s) => time >= s.start - 0.5 && time <= s.end);
  }

  /** Points `from` at `to`, and shows it merged if it has a letter. */
  function join(from: VoiceId, to: VoiceId) {
    sameAs.set(from, to);
    const shown = voices.get(from);
    if (shown) update({ ...shown, sameAs: to });
  }

  const sameName = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

  return {
    tag,
    covered,
    at(time) {
      if (!covered(time)) return undefined;
      const inside = turns.filter((t) => time >= t.start && time < t.end);
      const near = inside.length > 0 ? inside : turns.filter((t) => time >= t.start - NEAR_S && time < t.end + NEAR_S);
      if (near.length === 0) return undefined;
      const gap = (t: VoiceTurn) => Math.max(0, t.start - time, time - t.end);
      const best = near.reduce((a, b) => (gap(b) < gap(a) || (gap(b) === gap(a) && b.end - b.start > a.end - a.start) ? b : a));
      return tag(best.voice);
    },
    waitFor(time) {
      if (covered(time)) return Promise.resolve();
      return new Promise<void>((done) => {
        const entry = { time, done: () => {} };
        const timer = clock.setTimeout(() => {
          waiting = waiting.filter((w) => w !== entry);
          done();
        }, VOICE_WAIT_MS);
        entry.done = () => {
          clock.clearTimeout(timer);
          done();
        };
        waiting.push(entry);
      });
    },
    record(span, newTurns, merged) {
      spans = [span, ...spans].slice(0, KEPT);
      turns = [...newTurns, ...turns].slice(0, KEPT);
      for (const { voice, into } of merged) {
        const a = resolve(voice);
        const b = resolve(into);
        if (a === b) continue;
        const va = voices.get(a);
        const vb = voices.get(b);
        // The viewer said these are two people: they stay apart.
        if (va?.name && vb?.name && !sameName(va.name, vb.name)) continue;
        // The named one, else the one already shown, else the one it joined, is kept.
        const keepA = (!!va?.name && !vb?.name) || (!vb && !!va);
        if (keepA) join(b, a);
        else join(a, b);
      }
      const ready = waiting.filter((w) => covered(w.time));
      waiting = waiting.filter((w) => !ready.includes(w));
      for (const w of ready) w.done();
    },
    get: (voice) => voices.get(resolve(voice)),
    same: (a, b) => resolve(a) === resolve(b),
    name(voice, name) {
      const id = resolve(voice);
      const current = voices.get(id);
      if (!current) return;
      const namesake = [...voices.values()].find((v) => v.id !== id && !v.sameAs && sameName(v.name, name));
      const { skipped: _skipped, ...rest } = current;
      update({ ...rest, name: namesake?.name ?? name });
      if (namesake) join(id, namesake.id);
    },
    skip(voice) {
      const current = voices.get(resolve(voice));
      if (current) update({ ...current, skipped: true });
    },
    asking: (voice) => asking.has(resolve(voice)),
    setAsking(voice, on) {
      if (on) asking.add(resolve(voice));
      else asking.delete(resolve(voice));
    },
    reset() {
      voices = new Map();
      sameAs = new Map();
      asking = new Set();
      turns = [];
      spans = [];
      for (const w of waiting.splice(0)) w.done();
    },
  };
}

/** A, B, … Z, AA, AB, … */
function letters(n: number): string {
  let out = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(65 + ((i - 1) % 26)) + out;
  return out;
}
