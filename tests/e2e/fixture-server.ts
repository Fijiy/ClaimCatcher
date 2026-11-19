// A tiny local web server for the fixture pages in tests/e2e/pages. No audio
// or video files live in the repo: the quiet tone is generated here, and the
// speech clips are downloaded once into .cache/ (see SPEECH and SECOND_VOICE).

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = fileURLToPath(new URL('./pages/', import.meta.url));

/**
 * Speech for the on-device transcript: President Kennedy's "ask not what your
 * country can do for you" (11 s, 1961 inaugural address; a work of the US
 * government, so in the public domain), as Transformers.js's own docs use it.
 * Pinned by dataset revision and sha256.
 */
const SPEECH = {
  url: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/542437c29cc5273cfd29e25c77696f2b349badd7/jfk.wav',
  sha256: 'aa81c2552465568567e670f3823117e633900d16bd6202346a72f3c8464c74c8',
  file: fileURLToPath(new URL('../../.cache/fixtures/jfk.wav', import.meta.url)),
};
/**
 * A second voice, for voice separation: a LibriSpeech sample ("Mister Quilter
 * is the apostle of the middle classes…", 5.9 s, 16 kHz mono; LibriSpeech is
 * CC BY 4.0, from LibriVox public-domain recordings), from the same dataset.
 */
const SECOND_VOICE = {
  url: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/542437c29cc5273cfd29e25c77696f2b349badd7/librispeech_asr_demo_validation_0.wav',
  sha256: '799f78ed4beb4de7ceae3a809262d4ce242394342ccd1d58cef7d49dbc2def46',
  file: fileURLToPath(new URL('../../.cache/fixtures/librispeech-0.wav', import.meta.url)),
};
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export interface FixtureServer {
  /** e.g. http://127.0.0.1:53211 */
  origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const tone = toneWav(30);
  const speech = await download(SPEECH);
  // Two voices taking turns: Kennedy, the LibriSpeech reader, Kennedy again.
  const debate = debateWav([speech, await download(SECOND_VOICE), speech]);
  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://fixture').pathname;
    if (path === '/media/tone.wav') return sendBytes(req.headers.range, tone, 'audio/wav', res);
    if (path === '/media/speech.wav') return sendBytes(req.headers.range, speech, 'audio/wav', res);
    if (path === '/media/debate.wav') return sendBytes(req.headers.range, debate, 'audio/wav', res);
    const file = normalize(join(PAGES, path));
    if (!file.startsWith(PAGES)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('fixture server has no address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Media elements seek with Range requests, so honour them.
function sendBytes(range: string | undefined, bytes: Buffer, type: string, res: import('node:http').ServerResponse) {
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'accept-ranges': 'bytes' }).end(bytes);
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  res
    .writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${bytes.length}`,
      'accept-ranges': 'bytes',
    })
    .end(bytes.subarray(start, end + 1));
}

/** A speech clip, downloaded on first use and checked against its pinned sha256. */
async function download(clip: { url: string; sha256: string; file: string }): Promise<Buffer> {
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const cached = await readFile(clip.file).catch(() => null);
  if (cached && sha256(cached) === clip.sha256) return cached;
  const response = await fetch(clip.url);
  if (!response.ok) throw new Error(`speech fixture: ${clip.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== clip.sha256) throw new Error(`speech fixture: sha256 ${sha256(bytes)}, expected ${clip.sha256}`);
  await mkdir(dirname(clip.file), { recursive: true });
  await writeFile(`${clip.file}.part`, bytes);
  await rename(`${clip.file}.part`, clip.file);
  return bytes;
}

/** 16-bit PCM WAVs (any rate, mono or stereo) joined into one 16 kHz mono WAV, with 1.5 s of silence between them. */
function debateWav(clips: Buffer[]): Buffer {
  const rate = 16_000;
  const parts: Float32Array[] = [];
  for (const clip of clips) {
    parts.push(toMono16k(clip), new Float32Array(rate * 1.5));
  }
  const samples = parts.reduce((n, p) => n + p.length, 0);
  const wav = wavHeader(rate, samples);
  let at = 44;
  for (const part of parts) for (const x of part) at = wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), at);
  return wav;
}

function toMono16k(wav: Buffer): Float32Array {
  let offset = 12;
  let channels = 1;
  let rate = 16_000;
  while (wav.toString('ascii', offset, offset + 4) !== 'data') {
    if (wav.toString('ascii', offset, offset + 4) === 'fmt ') {
      channels = wav.readUInt16LE(offset + 10);
      rate = wav.readUInt32LE(offset + 12);
    }
    offset += 8 + wav.readUInt32LE(offset + 4);
  }
  const frames = wav.readUInt32LE(offset + 4) / 2 / channels;
  const data = offset + 8;
  const out = new Float32Array(Math.floor((frames * 16_000) / rate));
  for (let i = 0; i < out.length; i++) {
    // Nearest frame, channels averaged: plenty for a test fixture.
    const frame = Math.min(frames - 1, Math.floor((i * rate) / 16_000));
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += wav.readInt16LE(data + (frame * channels + c) * 2);
    out[i] = sum / channels / 32768;
  }
  return out;
}

function wavHeader(rate: number, samples: number): Buffer {
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

/** A mono 16 kHz, 16-bit WAV of a quiet 220 Hz tone. */
function toneWav(seconds: number): Buffer {
  const rate = 16_000;
  const samples = rate * seconds;
  const wav = wavHeader(rate, samples);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 2000), 44 + i * 2);
  }
  return wav;
}
