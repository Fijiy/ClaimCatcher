// The quality gates' clip audio: where `pnpm eval:fetch` puts it and how the
// gates read it back. It lives in eval/media/, which git ignores: clip media
// is never committed (see eval/README.md, "Terms").
//
// Every file is a plain WAV, 48 kHz mono 16-bit, holding exactly its window
// of the video: sample 0 is at the window's start on the video's timeline.
// 48 kHz is what a tab's media element usually gives, so the gates feed the
// shipped transcriber the rate it meets in the product and let it resample.

import { closeSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { option, ROOT } from './cli';

/** `--media <dir>` reads another copy (such as one resampled for an experiment). */
export const MEDIA = option('media') ?? join(ROOT, 'eval', 'media');
export const MEDIA_RATE = 48_000;

/** One clip's window, as `pnpm eval:fetch` saves it. */
export const clipAudio = (clip: string) => join(MEDIA, 'clips', `${clip}.wav`);
/** A whole debate (the voice gate's long run). */
export const fullAudio = (id: string) => join(MEDIA, 'full', `${id}.wav`);

export interface WavInfo {
  sampleRate: number;
  /** Samples (mono). */
  length: number;
}

/**
 * Reads a mono 16-bit PCM WAV in frames of `frameSeconds`, without holding it
 * all (a whole debate is half a gigabyte). Samples are scaled as the
 * extension decodes the tab's audio (`decodePcm`: / 32767).
 */
export function* readWav(path: string, frameSeconds = 0.25): Generator<Float32Array, void, undefined> {
  const fd = openSync(path, 'r');
  try {
    const { dataStart, dataBytes, sampleRate } = header(fd, path);
    const frameBytes = Math.round(frameSeconds * sampleRate) * 2;
    const buffer = Buffer.alloc(frameBytes);
    for (let at = 0; at < dataBytes; ) {
      const n = readSync(fd, buffer, 0, Math.min(frameBytes, dataBytes - at), dataStart + at);
      if (n <= 0) break;
      at += n;
      const samples = new Float32Array(n >> 1);
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32767;
      yield samples;
    }
  } finally {
    closeSync(fd);
  }
}

export function wavInfo(path: string): WavInfo {
  const fd = openSync(path, 'r');
  try {
    const { dataBytes, sampleRate } = header(fd, path);
    return { sampleRate, length: dataBytes >> 1 };
  } finally {
    closeSync(fd);
  }
}

/** Finds the format and data chunks (ffmpeg may put a LIST chunk between them). */
function header(fd: number, path: string): { dataStart: number; dataBytes: number; sampleRate: number } {
  const head = Buffer.alloc(12);
  readSync(fd, head, 0, 12, 0);
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`);
  let at = 12;
  let sampleRate = 0;
  const chunk = Buffer.alloc(24);
  for (;;) {
    if (readSync(fd, chunk, 0, 8, at) < 8) throw new Error(`${path} has no audio data`);
    const id = chunk.toString('ascii', 0, 4);
    const size = chunk.readUInt32LE(4);
    if (id === 'fmt ') {
      readSync(fd, chunk, 0, 16, at + 8);
      const [format, channels, bits] = [chunk.readUInt16LE(0), chunk.readUInt16LE(2), chunk.readUInt16LE(14)];
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error(`${path} must be mono 16-bit PCM (rerun pnpm eval:fetch)`);
      sampleRate = chunk.readUInt32LE(4);
    }
    if (id === 'data') return { dataStart: at + 8, dataBytes: size, sampleRate };
    at += 8 + size + (size & 1);
  }
}
