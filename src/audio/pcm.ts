// Audio as numbers: mono Float32 samples in [-1, 1]. The tab's audio arrives
// at the page's rate (usually 48 or 44.1 kHz); every on-device model takes
// 16 kHz mono.
//
// It crosses from the page to the offscreen document as 16-bit samples in a
// base64 string, because extension messages are JSON (a Float32Array would
// arrive as an object of numbered keys). It never goes anywhere else.

/** The sample rate the on-device models take. */
export const MODEL_RATE = 16_000;

/** Mono samples -> 16-bit little-endian PCM in base64. Values past ±1 are clipped. */
export function encodePcm(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    pcm[i] = Math.round(x * 32767);
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The reverse of `encodePcm`. */
export function decodePcm(data: string): Float32Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i]! / 32767;
  return samples;
}

export interface Resampler {
  /**
   * The 16 kHz samples these input samples complete. Keeps what's left over
   * for the next call, so the last couple of milliseconds come out with the
   * next frame. Output sample k lies at input time k / 16 kHz: no delay.
   */
  push(samples: Float32Array): Float32Array;
}

/** The low-pass edge, as a share of the slower rate's Nyquist (7.2 kHz for 16 kHz). */
const CUTOFF = 0.9;
/** The filter reaches this many 16 kHz samples (or input samples, if slower) either side. */
const HALF_WIDTH = 34;
/** Kaiser window shape: about 80 dB of stopband. With HALF_WIDTH it is fully down by about 7.8 kHz. */
const KAISER_BETA = 7.86;
/** Most filter phases kept; a rate needing more uses the nearest. */
const MAX_PHASES = 1024;

/**
 * Converts a stream at `fromRate` to 16 kHz with a windowed-sinc low-pass
 * (Kaiser), evaluated at each output sample's exact position in the input
 * (polyphase). It keeps the speech band flat up to about 6.6 kHz and removes
 * what 16 kHz can't hold (above 8 kHz) rather than folding it down into the
 * speech band, which hurt speech-to-text and telling voices apart (#41's
 * gates). The same samples come out however the input is split into frames.
 */
export function createResampler(fromRate: number): Resampler {
  const g = gcd(fromRate, MODEL_RATE);
  /** Each output sample advances the input by num / den samples. */
  const num = fromRate / g;
  const den = MODEL_RATE / g;
  const phases = Math.min(den, MAX_PHASES);
  /** Input samples per filter unit: wider when downsampling. */
  const unit = Math.max(1, fromRate / MODEL_RATE);
  const half = Math.ceil(HALF_WIDTH * unit);
  const taps = 2 * half;
  const table = filterTable(phases, half, CUTOFF / (2 * unit));

  // Input from absolute index `start` on; before the first sample, silence.
  let buffer: Float32Array = new Float32Array(half);
  let start = -half;
  /** The next output sample's input position: base + rem / den. */
  let base = 0;
  let rem = 0;

  return {
    push(samples) {
      const joined = new Float32Array(buffer.length + samples.length);
      joined.set(buffer);
      joined.set(samples, buffer.length);
      buffer = joined;
      const end = start + buffer.length;

      const out = new Float32Array(Math.max(0, Math.ceil(((end - half - base) * den) / num) + 1));
      let n = 0;
      // Output at base + frac takes input base - half + 1 ... base + half.
      while (base + half < end) {
        // The nearest kept phase; rounding up to a whole sample moves to the next one.
        const q = phases === den ? rem : Math.round((rem * phases) / den);
        const phase = q === phases ? 0 : q;
        const kernel = table.subarray(phase * taps, phase * taps + taps);
        const from = base + (q === phases ? 1 : 0) - half + 1 - start;
        let y = 0;
        for (let j = 0; j < taps; j++) y += kernel[j]! * buffer[from + j]!;
        out[n++] = y;
        rem += num;
        base += Math.floor(rem / den);
        rem %= den;
      }
      // Keep what the next output sample still needs.
      const keep = base - half + 1 - start;
      if (keep > 0) {
        buffer = buffer.slice(keep);
        start += keep;
      }
      return out.subarray(0, n);
    },
  };
}

/**
 * The filter for each phase (a fraction p / phases of an input sample past
 * the tap at offset 0), `2 * half` taps each, for input offsets
 * -half + 1 ... half. `cutoff` is in cycles per input sample. Each phase sums
 * to 1, so a steady level passes unchanged.
 */
function filterTable(phases: number, half: number, cutoff: number): Float32Array {
  const taps = 2 * half;
  const table = new Float32Array(phases * taps);
  const i0Beta = besselI0(KAISER_BETA);
  for (let p = 0; p < phases; p++) {
    const frac = p / phases;
    let sum = 0;
    const row = new Float64Array(taps);
    for (let j = 0; j < taps; j++) {
      const d = j - half + 1 - frac;
      const x = 2 * cutoff * d;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = d / half;
      const window = r * r >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / i0Beta;
      row[j] = sinc * window;
      sum += row[j]!;
    }
    for (let j = 0; j < taps; j++) table[p * taps + j] = row[j]! / sum;
  }
  return table;
}

/** The modified Bessel function of the first kind, order 0 (for the Kaiser window). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

function gcd(a: number, b: number): number {
  a = Math.round(a);
  b = Math.round(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
