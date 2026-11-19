// The footer's estimator: a pure function from the session's counters to
// low–high ranges of energy (Wh), carbon (g CO2e) and cost on the viewer's
// key (¢), using the bundled coefficient table (coefficients.ts). No browser
// API reports watts, so everything is estimated from counters.
//
// - Cloud LLM calls: the EcoLogits per-token method for the cloud model, at
//   the PUE range. EcoLogits counts output tokens only, so each input token
//   adds a share of an output token's energy (Jegham et al. to Epoch AI).
// - Gemini Nano, speech-to-text and voice separation: compute time on the
//   viewer's device times its extra power draw, whose class isn't known.
// - Search: a per-request range, for each search.
// - Carbon: energy at the grid factor.
// - Cost: what the provider billed where its replies said, the rest priced
//   from tokens; plus each search at its search's price (TinyFish is free).
//   Nano costs nothing.

import { searchesIn } from '../session/counters';
import { SEARCHES } from '../session/searches';
import type { SearchId, SessionCounters } from '../session/types';
import { COEFFICIENTS, type CoefficientTable } from './coefficients';

export interface Range {
  low: number;
  high: number;
}

export interface FootprintInput {
  counters: SessionCounters;
  /** How long the session has listened, in minutes: the length of video for the streaming comparison. */
  listenedMinutes: number;
}

export interface Footprint {
  energyWh: Range;
  carbonG: Range;
  costCents: Range;
  /** Streaming the same length of video, for comparison. */
  streaming: { minutes: number; energyWh: number };
  claims: number;
  /** Search requests, all searches together. */
  searches: number;
}

const SEARCH_IDS = Object.keys(SEARCHES) as SearchId[];
const ZERO: Range = { low: 0, high: 0 };
const add = (...ranges: Range[]): Range => ranges.reduce((a, b) => ({ low: a.low + b.low, high: a.high + b.high }), ZERO);
const scale = (range: Range, by: number): Range => ({ low: range.low * by, high: range.high * by });

export function estimateFootprint(input: FootprintInput, table: CoefficientTable = COEFFICIENTS): Footprint {
  const c = input.counters;
  const energyWh = add(
    cloudLlmWh(c, table),
    onDeviceWh(c.onDeviceSeconds, table),
    onDeviceWh(c.speechToTextMinutes * 60, table, table.speechToTextSpeed),
    onDeviceWh(c.voiceSeparationMinutes * 60, table, table.voiceSeparationSpeed),
    ...SEARCH_IDS.map((search) => scale(table.searchEnergy[search], c[SEARCHES[search].counter])),
  );
  const carbonG = { low: (energyWh.low / 1000) * table.grid.low, high: (energyWh.high / 1000) * table.grid.high };
  const minutes = Math.max(0, input.listenedMinutes);
  return {
    energyWh,
    carbonG,
    costCents: scale(costUsd(c, table), 100),
    streaming: { minutes, energyWh: (minutes / 60) * table.streaming.whPerHour },
    claims: c.claims,
    searches: searchesIn(c),
  };
}

/** The cloud model's energy per output token (Wh), EcoLogits: GPUs' share plus the server's, before PUE. */
export function whPerOutputToken(table: CoefficientTable = COEFFICIENTS): number {
  const e = table.ecologits;
  const { totalParamsB, activeParamsB } = table.cloudModel;
  const memoryGb = e.memoryOverhead * totalParamsB * e.bytesPerParam;
  // Rounded up to a power of two, as deployed: 1, 2, 4, 8…
  const gpus = 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(memoryGb / e.gpuMemoryGb))));
  const gpuWh = gpus * (e.alpha * Math.exp(e.beta * e.batch) * activeParamsB + e.gamma);
  const seconds = e.latency.a * activeParamsB + e.latency.b * e.batch + e.latency.c;
  const serverWh = (seconds / 3600) * e.serverWatts * (gpus / e.gpusPerServer) * (1 / e.batch);
  return gpuWh + serverWh;
}

function cloudLlmWh(c: SessionCounters, table: CoefficientTable): Range {
  const perToken = whPerOutputToken(table);
  const w = table.inputTokenWeight;
  return {
    low: (c.cloudTokensOut + c.cloudTokensIn * w.low) * perToken * table.pue.low,
    high: (c.cloudTokensOut + c.cloudTokensIn * w.high) * perToken * table.pue.high,
  };
}

/**
 * Energy on the viewer's device: `seconds` of work (of audio, if `speed`
 * turns audio into compute time) at the device's extra power draw.
 */
function onDeviceWh(seconds: number, table: CoefficientTable, speed: Range = { low: 1, high: 1 }): Range {
  if (!(seconds > 0)) return ZERO;
  return {
    low: (seconds * speed.low * table.devicePower.low) / 3600,
    high: (seconds * speed.high * table.devicePower.high) / 3600,
  };
}

function costUsd(c: SessionCounters, table: CoefficientTable): Range {
  const p = table.cloudPrice;
  const unpriced = c.cloudCalls > 0 ? Math.max(0, c.cloudCalls - c.cloudBilledCalls) / c.cloudCalls : 0;
  const fromTokens = ((c.cloudTokensIn * p.inputPerMillion + c.cloudTokensOut * p.outputPerMillion) / 1e6) * unpriced;
  const llm = c.cloudBilledUsd + fromTokens;
  return add({ low: llm, high: llm }, ...SEARCH_IDS.map((search) => scale(table.searchPrice[search], c[SEARCHES[search].counter])));
}
