// Uncertainty for the held-out accuracy report (docs/quality-gate.md,
// "Held-out accuracy"): 95% Wilson score intervals for rates, and a
// stratified bootstrap for balanced accuracy (each truth class resampled at
// its own size, since balanced accuracy weighs the classes equally).

export interface Interval {
  lo: number;
  hi: number;
}

const Z95 = 1.959964;

/** The 95% Wilson score interval for `hits` out of `n`. */
export function wilson(hits: number, n: number, z = Z95): Interval {
  if (n === 0) return { lo: 0, hi: 0 };
  const p = hits / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** A small seeded PRNG (mulberry32), so a report's intervals can be reproduced. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The 95% percentile interval of balanced accuracy (the mean of the per-class
 * hit rates) over `iterations` stratified resamples. `hits` holds, per truth
 * class, whether each claim of that class got an exact match.
 */
export function bootstrapBalanced(hits: Record<string, boolean[]>, { iterations = 10_000, seed = 1 }: { iterations?: number; seed?: number } = {}): Interval {
  const classes = Object.values(hits).filter((h) => h.length > 0);
  if (classes.length === 0) return { lo: 0, hi: 0 };
  const next = random(seed);
  const values: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (const h of classes) {
      let k = 0;
      for (let j = 0; j < h.length; j++) if (h[Math.floor(next() * h.length)]) k++;
      sum += k / h.length;
    }
    values.push(sum / classes.length);
  }
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))]!;
  return { lo: at(0.025), hi: at(0.975) };
}
