// The footer's coefficient table: every figure the estimator (estimate.ts)
// uses, with where it comes from. Built from the footprint research (map
// ticket #5, branch research/environmental-footprint, and cac-notes
// prior-research.md §2), checked 2026-10-26. The exact figures are still open
// on the map: change them here; the estimator's interface stays the same.
//
// `basis`: sourced = taken from the source; derived = arithmetic on sourced
// figures; measured = measured on this project's own models; assumption =
// ours, with no source behind it. `low`/`high` are the range's two ends.

import type { SearchId } from '../session/types';

export type Basis = 'sourced' | 'derived' | 'measured' | 'assumption';

export interface Sourced {
  /** Where the figure comes from, in a few words. */
  source: string;
  url?: string;
  basis: Basis;
}

export interface RangeCoefficient extends Sourced {
  low: number;
  high: number;
  unit: string;
}

export interface CoefficientTable {
  /** Grams of CO2e per kWh. */
  grid: RangeCoefficient;
  /** The data centre's power usage effectiveness (cloud calls only). */
  pue: RangeCoefficient;
  /** EcoLogits' per-token energy model for LLM inference on H100s. */
  ecologits: Sourced & {
    /** f_E(P_active, B) = alpha · e^(beta·B) · P_active + gamma, in Wh per output token per GPU. */
    alpha: number;
    beta: number;
    gamma: number;
    /** Fixed batch size B. */
    batch: number;
    /** GPU memory (GB), model weights' bytes per parameter (16-bit), and the memory overhead factor. */
    gpuMemoryGb: number;
    bytesPerParam: number;
    memoryOverhead: number;
    /** Latency fallback f_L(P_active, B) = a·P_active + b·B + c, seconds per output token. */
    latency: { a: number; b: number; c: number };
    /** Non-GPU server power (W), shared across this many installed GPUs. */
    serverWatts: number;
    gpusPerServer: number;
  };
  /** The model cloud mode uses: its size, which sets its energy per token. */
  cloudModel: Sourced & { id: string; totalParamsB: number; activeParamsB: number };
  /**
   * EcoLogits counts output tokens only, and these calls are input-heavy
   * (about 3,000 tokens in, 300 out). Each input token is counted as this
   * share of an output token's energy.
   */
  inputTokenWeight: RangeCoefficient;
  /** Wh per search request, for each search (cloud mode's provider, and local mode's choices). */
  searchEnergy: Record<SearchId, RangeCoefficient>;
  /** Extra watts the viewer's device draws while running a model on it. */
  devicePower: RangeCoefficient;
  /** Seconds of compute per second of audio, on the device. */
  speechToTextSpeed: RangeCoefficient;
  voiceSeparationSpeed: RangeCoefficient;
  /** The provider's price for the cloud model, USD per million tokens (used only when a reply gives no price). */
  cloudPrice: Sourced & { id: string; inputPerMillion: number; outputPerMillion: number };
  /** USD per search request, for each search. */
  searchPrice: Record<SearchId, RangeCoefficient>;
  /** Wh per hour of streamed video, for the comparison. */
  streaming: Sourced & { whPerHour: number };
}

/** No search publishes its energy per search: one shared range, from Google's 2009 figure. */
const SEARCH_ENERGY_SOURCE = "Google's 2009 figure of 0.3 Wh a search (stale), the low end assuming 10× better since";
const SEARCH_ENERGY = {
  low: 0.03,
  high: 0.3,
  unit: 'Wh/search',
  url: 'https://googleblog.blogspot.com/2009/01/powering-google-search.html',
  basis: 'derived',
} as const;

export const COEFFICIENTS = {
  grid: {
    low: 367,
    high: 367,
    unit: 'g CO2e/kWh',
    source: 'US average grid, location-based: EIA, 0.81 lb CO2/kWh (2023)',
    url: 'https://www.eia.gov/tools/faqs/faq.php?id=74&t=11',
    basis: 'derived',
  },
  pue: {
    low: 1.09,
    high: 1.2,
    unit: '×',
    source: "EcoLogits' provider PUE table (1.09 Google to 1.20 OpenAI); Venice publishes none, so the whole span",
    url: 'https://ecologits.ai/latest/methodology/llm_inference/',
    basis: 'sourced',
  },
  ecologits: {
    alpha: 1.17e-6,
    beta: -1.12e-2,
    gamma: 4.05e-5,
    batch: 64,
    gpuMemoryGb: 80,
    bytesPerParam: 2,
    memoryOverhead: 1.2,
    latency: { a: 6.78e-4, b: 3.12e-4, c: 1.94e-2 },
    serverWatts: 1_200,
    gpusPerServer: 8,
    source: 'EcoLogits LLM inference methodology (MPL-2.0), fitted to ML.ENERGY H100 data; implemented here, not copied',
    url: 'https://ecologits.ai/latest/methodology/llm_inference/',
    basis: 'sourced',
  },
  cloudModel: {
    id: 'qwen3-235b-a22b-instruct-2507',
    totalParamsB: 235,
    activeParamsB: 22,
    source: 'Qwen3-235B-A22B-Instruct-2507 model card: 235B in total, 22B activated',
    url: 'https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507',
    basis: 'sourced',
  },
  inputTokenWeight: {
    low: 0.05,
    high: 0.37,
    unit: 'output tokens per input token',
    source:
      'Low: fitted to Jegham et al. v6 (Llama-3.3-70B, 1k/1k → 10k/1.5k tokens: 0.76 → 1.45 Wh). High: Epoch AI (GPT-4o, ~0.3 Wh at 500 out, ~2.5 Wh at 10k in)',
    url: 'https://arxiv.org/html/2505.09598v6',
    basis: 'derived',
  },
  searchEnergy: {
    venice: { ...SEARCH_ENERGY, source: `${SEARCH_ENERGY_SOURCE}. No search publishes its own` },
    tinyfish: { ...SEARCH_ENERGY, source: `TinyFish publishes none: ${SEARCH_ENERGY_SOURCE}` },
  },
  devicePower: {
    low: 5,
    high: 60,
    unit: 'W',
    source:
      'Apple Silicon +5–15 W (GreenBench, arXiv:2608.28667, preprint) up to a discrete-GPU laptop at +20–60 W; no browser API reports watts',
    url: 'https://arxiv.org/abs/2608.28667',
    basis: 'derived',
  },
  speechToTextSpeed: {
    low: 0.04,
    high: 0.12,
    unit: 's compute/s audio',
    source: 'Moonshine base 8-bit measured at 4% of real time on an M4 Mac (spec #26, prototype/local-mode-eval); 3× slower devices assumed for the high end',
    url: 'https://github.com/Fijiy/CAC/issues/26',
    basis: 'measured',
  },
  voiceSeparationSpeed: {
    low: 0.015,
    high: 0.05,
    unit: 's compute/s audio',
    source: 'pyannote segmentation-3.0 + WeSpeaker measured at ~0.5 s per 35 s of audio on an M4 CPU (#37); about 3× slower devices assumed for the high end',
    url: 'https://github.com/Fijiy/CAC/issues/37',
    basis: 'measured',
  },
  cloudPrice: {
    id: 'qwen3-235b-a22b-instruct-2507',
    inputPerMillion: 0.15,
    outputPerMillion: 0.75,
    source: "Venice's price list; replies give their own price (cost.usd), which is used instead whenever they do",
    url: 'https://docs.venice.ai/overview/pricing',
    basis: 'sourced',
  },
  searchPrice: {
    venice: {
      low: 0.01,
      high: 0.01,
      unit: 'USD/search',
      source: 'Venice search: $0.01 per request',
      url: 'https://docs.venice.ai/api-reference/endpoint/augment/search',
      basis: 'sourced',
    },
    tinyfish: {
      low: 0,
      high: 0,
      unit: 'USD/search',
      source: 'TinyFish Search: $0.00 per request, free with a free key (limits 30 a minute, 500 an hour), checked 2026-10-26',
      url: 'https://www.tinyfish.ai/pricing',
      basis: 'sourced',
    },
  },
  streaming: {
    whPerHour: 77,
    source: 'IEA: about 0.077 kWh per hour of streaming video (2019), so about 115 Wh per 90 minutes',
    url: 'https://www.iea.org/commentaries/the-carbon-footprint-of-streaming-video-fact-checking-the-headlines',
    basis: 'sourced',
  },
} as const satisfies CoefficientTable;

/**
 * Every sourced figure in the table, one per entry, the per-search ones
 * (`searchEnergy.tinyfish`…) included: for the breakdown's list of sources.
 */
export function coefficientEntries(table: CoefficientTable = COEFFICIENTS): Array<[string, Sourced]> {
  return Object.entries(table).flatMap(([name, entry]): Array<[string, Sourced]> =>
    'source' in entry
      ? [[name, entry as Sourced]]
      : Object.entries(entry as Record<string, Sourced>).map(([search, value]): [string, Sourced] => [`${name}.${search}`, value]),
  );
}
