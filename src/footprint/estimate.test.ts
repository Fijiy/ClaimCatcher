// The footer's estimator: session counters in, low–high ranges of energy,
// carbon and cost out, from the bundled coefficient table. Expected values
// come from the footprint research's worked examples (cac-notes
// prior-research.md §2) and the spec's figures, worked by hand.

import { describe, expect, it } from 'vitest';
import { PROVISIONAL_MODEL } from '../session/checks/venice';
import { NO_COUNTS } from '../session/counters';
import type { SessionCounters } from '../session/types';
import { COEFFICIENTS, coefficientEntries } from './coefficients';
import { estimateFootprint, type Range } from './estimate';

const counts = (c: Partial<SessionCounters>): SessionCounters => ({ ...NO_COUNTS, ...c });
const estimate = (c: Partial<SessionCounters>, listenedMinutes = 0) => estimateFootprint({ counters: counts(c), listenedMinutes });

function expectRange(range: Range, low: number, high: number, digits = 2) {
  expect(range.low).toBeCloseTo(low, digits);
  expect(range.high).toBeCloseTo(high, digits);
}

describe('estimator: known counters', () => {
  it('is zero for a session that used nothing', () => {
    const f = estimate({});
    expect(f.energyWh).toEqual({ low: 0, high: 0 });
    expect(f.carbonG).toEqual({ low: 0, high: 0 });
    expect(f.costCents).toEqual({ low: 0, high: 0 });
  });

  it("puts 300 tokens out of the cloud model at 0.23–0.25 Wh (EcoLogits, qwen3-235b-a22b, PUE 1.09–1.20)", () => {
    // The research's worked example: 8 GPUs, E_gpu ≈ 0.127 Wh, E_server ≈ 0.085 Wh.
    const f = estimate({ cloudCalls: 1, cloudTokensOut: 300 });
    expectRange(f.energyWh, 0.231, 0.255, 2);
  });

  it('adds 0.05–0.37 of an output token for each token in: 3,000 in makes a 300-token reply 1.5–4.7× as costly', () => {
    const replyOnly = estimate({ cloudCalls: 1, cloudTokensOut: 300 }).energyWh;
    const withPrompt = estimate({ cloudCalls: 1, cloudTokensIn: 3_000, cloudTokensOut: 300 }).energyWh;
    expect(withPrompt.low / replyOnly.low).toBeCloseTo(1.5, 5);
    expect(withPrompt.high / replyOnly.high).toBeCloseTo(4.7, 5);
  });

  it('counts 0.03–0.3 Wh and 1¢ per Venice search', () => {
    const f = estimate({ veniceSearches: 10 });
    expectRange(f.energyWh, 0.3, 3);
    expectRange(f.costCents, 10, 10);
  });

  it('counts 0.03–0.3 Wh per TinyFish search, and nothing to pay (it is free)', () => {
    const f = estimate({ tinyfishSearches: 10 });
    expectRange(f.energyWh, 0.3, 3);
    expect(f.costCents).toEqual({ low: 0, high: 0 });
    expect(f.searches).toBe(10);
  });

  it('turns energy into carbon at the US average grid, 367 g/kWh', () => {
    const f = estimate({ veniceSearches: 10 });
    expectRange(f.carbonG, 0.11, 1.1, 2);
  });

  it("puts 90 minutes of on-device speech-to-text at 0.3–10.8 Wh (4–12% of real time, at 5–60 W)", () => {
    expectRange(estimate({ speechToTextMinutes: 90 }).energyWh, 0.3, 10.8);
  });

  it('puts 90 minutes of voice separation at 0.11–4.5 Wh (1.5–5% of real time, at 5–60 W)', () => {
    expectRange(estimate({ voiceSeparationMinutes: 90 }).energyWh, 0.1125, 4.5, 3);
  });

  it("puts Gemini Nano's time on the device at 5–60 W: 72 s is 0.1–1.2 Wh, and costs nothing", () => {
    const f = estimate({ onDeviceCalls: 8, onDeviceTokensIn: 8_000, onDeviceTokensOut: 800, onDeviceSeconds: 72 });
    expectRange(f.energyWh, 0.1, 1.2);
    expect(f.costCents).toEqual({ low: 0, high: 0 });
  });

  it("uses what the provider billed when every reply gave a price", () => {
    const f = estimate({ cloudCalls: 4, cloudTokensIn: 12_000, cloudTokensOut: 1_200, cloudBilledUsd: 0.0123, cloudBilledCalls: 4 });
    expectRange(f.costCents, 1.23, 1.23, 5);
  });

  it("prices calls without a price from their tokens: $0.15 per million in, $0.75 out", () => {
    const f = estimate({ cloudCalls: 2, cloudTokensIn: 1_000_000, cloudTokensOut: 1_000_000 });
    expectRange(f.costCents, 90, 90, 5);
  });

  it('prices only the unpriced share of calls from tokens when some replies gave a price', () => {
    // Half the calls billed 10¢; the other half's share of 1M in + 1M out is 45¢.
    const f = estimate({ cloudCalls: 2, cloudTokensIn: 1_000_000, cloudTokensOut: 1_000_000, cloudBilledUsd: 0.1, cloudBilledCalls: 1 });
    expectRange(f.costCents, 55, 55, 5);
  });

  it('compares with streaming the same length of video: about 115 Wh per 90 minutes (IEA)', () => {
    const f = estimate({}, 90);
    expect(f.streaming.minutes).toBe(90);
    expect(f.streaming.energyWh).toBeCloseTo(115.5, 1);
  });

  it('says how many claims and searches there were', () => {
    const f = estimate({ claims: 6, veniceSearches: 13 });
    expect(f.claims).toBe(6);
    expect(f.searches).toBe(13);
  });
});

describe('estimator: the ranges widen sensibly', () => {
  const typicalCloud = counts({
    cloudCalls: 120,
    cloudTokensIn: 300_000,
    cloudTokensOut: 30_000,
    veniceSearches: 110,
    claims: 50,
    speechToTextMinutes: 20,
  });
  const typicalLocal = counts({
    onDeviceCalls: 120,
    onDeviceTokensIn: 300_000,
    onDeviceTokensOut: 30_000,
    onDeviceSeconds: 600,
    tinyfishSearches: 110,
    claims: 50,
    speechToTextMinutes: 20,
  });

  it('never puts the low end above the high end', () => {
    for (const c of [NO_COUNTS, typicalCloud, typicalLocal, counts({ cloudCalls: 1, cloudTokensIn: 50, cloudTokensOut: 1 })]) {
      const f = estimateFootprint({ counters: c, listenedMinutes: 30 });
      for (const r of [f.energyWh, f.carbonG, f.costCents]) {
        expect(r.low).toBeGreaterThanOrEqual(0);
        expect(r.low).toBeLessThanOrEqual(r.high);
      }
    }
  });

  it('grows both ends with use, keeping their ratio: twice the session, twice the range', () => {
    const once = estimateFootprint({ counters: typicalCloud, listenedMinutes: 30 });
    const twice = estimateFootprint({
      counters: Object.fromEntries(Object.entries(typicalCloud).map(([k, v]) => [k, v * 2])) as unknown as SessionCounters,
      listenedMinutes: 60,
    });
    expect(twice.energyWh.low).toBeCloseTo(once.energyWh.low * 2, 6);
    expect(twice.energyWh.high).toBeCloseTo(once.energyWh.high * 2, 6);
    expect(twice.costCents.high).toBeCloseTo(once.costCents.high * 2, 6);
  });

  it('only grows when something more is used', () => {
    const base = estimateFootprint({ counters: typicalCloud, listenedMinutes: 30 });
    const more: Array<[string, Partial<SessionCounters>]> = [
      ['a cloud call', { cloudCalls: 1, cloudTokensIn: 2_500, cloudTokensOut: 250 }],
      ['a short cloud call', { cloudCalls: 1, cloudTokensIn: 100, cloudTokensOut: 20 }],
      ['a Nano prompt', { onDeviceCalls: 1, onDeviceTokensIn: 2_500, onDeviceTokensOut: 250, onDeviceSeconds: 8 }],
      ['a Venice search', { veniceSearches: 1 }],
      ['a TinyFish search', { tinyfishSearches: 1 }],
      ['a minute of speech-to-text', { speechToTextMinutes: 1 }],
      ['a minute of voice separation', { voiceSeparationMinutes: 1 }],
    ];
    for (const [what, delta] of more) {
      const counters = { ...typicalCloud };
      for (const [k, v] of Object.entries(delta) as Array<[keyof SessionCounters, number]>) counters[k] += v;
      const after = estimateFootprint({ counters, listenedMinutes: 30 });
      expect(after.energyWh.low, what).toBeGreaterThan(base.energyWh.low);
      expect(after.energyWh.high, what).toBeGreaterThan(base.energyWh.high);
      expect(after.costCents.low, what).toBeGreaterThanOrEqual(base.costCents.low);
    }
  });

  it("is wider on the device than in the cloud, because the viewer's device class isn't known", () => {
    const ratio = (r: Range) => r.high / r.low;
    const cloud = estimateFootprint({ counters: typicalCloud, listenedMinutes: 30 }).energyWh;
    const local = estimateFootprint({ counters: typicalLocal, listenedMinutes: 30 }).energyWh;
    expect(ratio(local)).toBeGreaterThan(ratio(cloud));
    // But never wider than the table's own spread allows: 12× power and 3× speed on the device, 10× search.
    expect(ratio(local)).toBeLessThanOrEqual(36);
    expect(ratio(cloud)).toBeLessThanOrEqual(36);
  });

  it('keeps carbon in step with energy: same ratio, one grid factor', () => {
    const f = estimateFootprint({ counters: typicalLocal, listenedMinutes: 30 });
    expect(f.carbonG.low / f.energyWh.low).toBeCloseTo(0.367, 6);
    expect(f.carbonG.high / f.energyWh.high).toBeCloseTo(0.367, 6);
  });
});

describe('the coefficient table', () => {
  it('records a source for every value', () => {
    for (const [name, entry] of coefficientEntries()) {
      expect(entry.source.trim(), name).not.toBe('');
      expect(['sourced', 'derived', 'measured', 'assumption'], name).toContain(entry.basis);
      if (entry.basis !== 'assumption') expect(entry.url, name).toMatch(/^https:\/\//);
    }
  });

  it("describes the model cloud mode uses, so a new pick can't go unpriced", () => {
    expect(COEFFICIENTS.cloudModel.id).toBe(PROVISIONAL_MODEL);
    expect(COEFFICIENTS.cloudPrice.id).toBe(PROVISIONAL_MODEL);
  });
});
