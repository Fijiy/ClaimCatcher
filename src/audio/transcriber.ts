// The tab's audio -> on-device transcript segments. Lives in the offscreen
// document, fed by whichever audio source is capturing the tab (the page's
// media element through captureStream(); tabCapture for blocked players,
// #35). It:
//
//   1. converts each frame to 16 kHz mono (pcm.ts);
//   2. measures the level every 100 ms, and reports whether audio is flowing:
//      on at the first sound, off after 3 s of silence or when frames stop;
//   3. cuts the audio into pieces at pauses (at least 5 s long, at most 15 s;
//      a piece with no pause is cut at its quietest moment after 10 s).
//      Moonshine is much less accurate on short pieces: it dropped a 2 s
//      "Ask not." that it heard fine inside a 5 s piece. The cut falls inside
//      the pause, so each piece starts with a moment of lead-in;
//   4. runs speech-to-text on each piece that has any sound, one at a time,
//      and reports its words with the media times its sound starts and ends;
//   5. while voice separation is on, runs it on each piece first, and tags
//      the piece's words with the voice that spoke most of it. Switching it on
//      also separates the pieces of the last 30 s, already transcribed, so the
//      lines they made get their voices too.
//
// Moonshine has no timestamps of its own, so a segment's times are its
// piece's. Pieces under 1 s are padded, since Moonshine gives nothing for them.

import type { Clock, OnDeviceSegment, TimerHandle, VoiceId, VoiceTurn } from '../session/types';
import { createResampler, MODEL_RATE, type Resampler } from './pcm';

/** Mono audio from the tab. */
export interface PcmFrame {
  sampleRate: number;
  samples: Float32Array;
  /** Media time of the first sample, in seconds (the video's `currentTime`). */
  time: number;
}

export interface Transcriber {
  push(frame: PcmFrame): void;
  /** Voice separation on or off (it needs `separate`). */
  separateVoices(on: boolean): void;
  /** Stops: drops queued audio, and reports nothing more. */
  close(): void;
}

export interface TranscriberDeps {
  clock: Clock;
  /** Speech-to-text on 16 kHz mono samples (the model worker's). */
  transcribe(samples: Float32Array): Promise<string>;
  onSegment(segment: OnDeviceSegment): void;
  onFlowing(flowing: boolean): void;
  /** Speech-to-text ran on this many seconds of audio (one piece, with or without words); for the footer's counters. */
  onTranscribed?(seconds: number): void;
  /**
   * Voice separation on 16 kHz mono samples starting at media time `time`:
   * who spoke when (media times). Gets its own copy of the samples.
   */
  separate?(samples: Float32Array, time: number): Promise<VoiceTurn[]>;
}

const BLOCK = MODEL_RATE / 10; // 100 ms
const BLOCK_S = 0.1;
/** A 100 ms block this loud (RMS, about -46 dBFS) has sound in it. */
const SOUND_RMS = 0.005;
/** In a piece, a block quieter than this share of its loudest block counts as a pause. */
const PAUSE_SHARE = 0.15;
const PAUSE_BLOCKS = 5; // 500 ms
const MIN_PIECE_BLOCKS = 50; // 5 s
/** Of a pause that ends a piece, this much starts the next one. */
const PAUSE_LEAD_IN_BLOCKS = 2;
const CUT_FROM_BLOCKS = 100; // 10 s
const MAX_PIECE_BLOCKS = 150; // 15 s
const LEAD_IN_BLOCKS = 3;
/** Audio stops flowing after this much silence. */
const NOT_FLOWING_BLOCKS = 30; // 3 s
/** Frames stopped coming (paused, or the source ended) after this long. */
const IDLE_MS = 1_500;
/** A frame this far from where the last one ended is a jump (a seek). */
const JUMP_S = 0.5;
/** Pieces waiting for speech-to-text beyond this many are dropped, oldest first (a slow device). */
const MAX_WAITING = 4;
/** Switching voice separation on separates this much audio already transcribed, in seconds. */
const SEPARATE_BACK_S = 30;

interface Block {
  samples: Float32Array;
  rms: number;
  time: number;
}

export function createTranscriber(deps: TranscriberDeps): Transcriber {
  const { clock } = deps;
  let closed = false;
  let flowing = false;
  let quietBlocks = 0;
  let idleTimer: TimerHandle | null = null;

  let rate = 0;
  let resampler: Resampler | null = null;
  /** Media time the last frame ended, to spot jumps. */
  let expected: number | null = null;
  /** Media time of the next 16 kHz sample. */
  let cursor = 0;
  let block = new Float32Array(BLOCK);
  let fill = 0;
  let blockTime = 0;

  let piece: Block[] = [];
  let loudest = 0;

  interface Piece {
    samples: Float32Array;
    /** Media time of its first sample. */
    time: number;
    /** Media times its sound starts and ends. */
    start: number;
    end: number;
    /** False for a piece only to be separated (transcribed before voice separation was on). */
    transcribe: boolean;
  }
  const waiting: Piece[] = [];
  let transcribing = false;
  let separating = false;
  /** Pieces transcribed while voice separation was off, newest last, for when it comes on. */
  let unseparated: Piece[] = [];

  function setFlowing(now: boolean) {
    if (now === flowing) return;
    flowing = now;
    deps.onFlowing(now);
  }

  function addBlock(b: Block) {
    if (b.rms >= SOUND_RMS) {
      quietBlocks = 0;
      setFlowing(true);
    } else if (++quietBlocks >= NOT_FLOWING_BLOCKS) {
      setFlowing(false);
    }

    piece.push(b);
    loudest = Math.max(loudest, b.rms);
    if (loudest < SOUND_RMS) {
      // Nothing heard yet: keep only a short lead-in.
      if (piece.length > LEAD_IN_BLOCKS) piece = piece.slice(-LEAD_IN_BLOCKS);
      return;
    }
    const pauseBelow = Math.max(SOUND_RMS, loudest * PAUSE_SHARE);
    const paused = piece.length >= PAUSE_BLOCKS && piece.slice(-PAUSE_BLOCKS).every((x) => x.rms < pauseBelow);
    if (piece.length >= MIN_PIECE_BLOCKS && paused) return cut(piece.length - PAUSE_LEAD_IN_BLOCKS);
    if (piece.length >= MAX_PIECE_BLOCKS) {
      let quietest = CUT_FROM_BLOCKS;
      for (let i = CUT_FROM_BLOCKS; i < piece.length; i++) if (piece[i]!.rms < piece[quietest]!.rms) quietest = i;
      cut(quietest + 1);
    }
  }

  /** Sends the first `n` blocks of the piece to speech-to-text; the rest start the next piece. */
  function cut(n: number) {
    const done = piece.slice(0, n);
    piece = piece.slice(n);
    loudest = piece.reduce((max, b) => Math.max(max, b.rms), 0);
    const sounding = done.filter((b) => b.rms >= SOUND_RMS);
    if (sounding.length === 0) return;
    const samples = new Float32Array(Math.max(MODEL_RATE, done.length * BLOCK));
    done.forEach((b, i) => samples.set(b.samples, i * BLOCK));
    waiting.push({ samples, time: done[0]!.time, start: sounding[0]!.time, end: sounding.at(-1)!.time + BLOCK_S, transcribe: true });
    if (waiting.filter((p) => p.transcribe).length > MAX_WAITING) {
      waiting.splice(waiting.findIndex((p) => p.transcribe), 1);
      console.warn('[ClaimCatcher] speech-to-text is falling behind; skipped some audio');
    }
    void drain();
  }

  /** The voice that spoke most of [start, end], if voice separation ran there. */
  async function voiceOf(piece: Piece): Promise<VoiceId | undefined> {
    if (!separating || !deps.separate) return undefined;
    try {
      const turns = await deps.separate(piece.samples.slice(), piece.time);
      const spoke = new Map<VoiceId, number>();
      for (const t of turns) {
        const overlap = Math.min(t.end, piece.end) - Math.max(t.start, piece.start);
        if (overlap > 0) spoke.set(t.voice, (spoke.get(t.voice) ?? 0) + overlap);
      }
      return [...spoke].sort((a, b) => b[1] - a[1])[0]?.[0];
    } catch (error) {
      console.warn('[ClaimCatcher] voice separation failed on a piece of audio', error);
      return undefined;
    }
  }

  async function drain() {
    if (transcribing) return;
    transcribing = true;
    try {
      for (let next = waiting.shift(); next && !closed; next = waiting.shift()) {
        const wasSeparating = separating && !!deps.separate;
        const voice = await voiceOf(next);
        if (!next.transcribe || closed) continue;
        if (!wasSeparating) {
          // Kept (a copy: speech-to-text takes the buffer) in case voice separation comes on.
          unseparated.push({ ...next, samples: next.samples.slice(), transcribe: false });
          unseparated = unseparated.filter((p) => p.end >= next.end - SEPARATE_BACK_S);
        }
        let text = '';
        try {
          const seconds = next.samples.length / MODEL_RATE;
          text = (await deps.transcribe(next.samples)).trim();
          if (!closed) deps.onTranscribed?.(seconds);
        } catch (error) {
          console.warn('[ClaimCatcher] speech-to-text failed on a piece of audio', error);
        }
        if (text && !closed) deps.onSegment({ start: next.start, end: next.end, text, ...(voice ? { voice } : {}) });
      }
    } finally {
      transcribing = false;
    }
  }

  /** Ends the current piece: a jump, a new rate, or frames stopped coming. */
  function endPiece() {
    if (fill > 0) {
      const samples = block.slice(0, fill);
      piece.push({ samples, rms: rms(samples), time: blockTime });
    }
    fill = 0;
    cut(piece.length);
    piece = [];
    loudest = 0;
    resampler = null;
    expected = null;
  }

  function idle() {
    idleTimer = null;
    endPiece();
    quietBlocks = 0;
    setFlowing(false);
  }

  return {
    separateVoices(on) {
      if (on === separating) return;
      separating = on;
      if (!on || !deps.separate) return;
      // The last 30 s already transcribed go first, oldest first.
      const latest = Math.max(...unseparated.map((p) => p.end), -Infinity);
      waiting.unshift(...unseparated.filter((p) => p.end >= latest - SEPARATE_BACK_S));
      unseparated = [];
      void drain();
    },
    push(frame) {
      if (closed || frame.samples.length === 0) return;
      if (idleTimer !== null) clock.clearTimeout(idleTimer);
      idleTimer = clock.setTimeout(idle, IDLE_MS);

      const jumped = expected !== null && Math.abs(frame.time - expected) > JUMP_S;
      if (jumped || frame.sampleRate !== rate) endPiece();
      if (!resampler) {
        rate = frame.sampleRate;
        resampler = createResampler(rate);
        cursor = frame.time;
      }
      expected = frame.time + frame.samples.length / frame.sampleRate;

      for (const x of resampler.push(frame.samples)) {
        if (fill === 0) blockTime = cursor;
        block[fill++] = x;
        cursor += 1 / MODEL_RATE;
        if (fill === BLOCK) {
          addBlock({ samples: block, rms: rms(block), time: blockTime });
          block = new Float32Array(BLOCK);
          fill = 0;
        }
      }
    },
    close() {
      closed = true;
      if (idleTimer !== null) clock.clearTimeout(idleTimer);
      idleTimer = null;
      waiting.length = 0;
      unseparated = [];
    },
  };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const x of samples) sum += x * x;
  return Math.sqrt(sum / samples.length);
}
