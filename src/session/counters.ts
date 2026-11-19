// The session's counters (SessionCounters): what it has used, for the footer's
// cost and footprint estimate. The session adds to them with `count(delta)`
// (session.ts), which emits the whole object as a `counters` event; the
// provider adapters report each answered call as a `Usage` (checks/provider.ts).

import type { Usage } from './checks/provider';
import { SEARCHES } from './searches';
import type { SessionCounters } from './types';

/** Every search request answered, whichever search answered it. */
export function searchesIn(counters: SessionCounters): number {
  return Object.values(SEARCHES).reduce((total, search) => total + counters[search.counter], 0);
}

export const NO_COUNTS: SessionCounters = {
  cloudCalls: 0,
  cloudTokensIn: 0,
  cloudTokensOut: 0,
  cloudBilledUsd: 0,
  cloudBilledCalls: 0,
  onDeviceCalls: 0,
  onDeviceTokensIn: 0,
  onDeviceTokensOut: 0,
  onDeviceSeconds: 0,
  veniceSearches: 0,
  tinyfishSearches: 0,
  claims: 0,
  speechToTextMinutes: 0,
  voiceSeparationMinutes: 0,
};

/** `counters` plus `delta`, field by field. */
export function addCounts(counters: SessionCounters, delta: Partial<SessionCounters>): SessionCounters {
  const next = { ...counters };
  for (const key of Object.keys(delta) as Array<keyof SessionCounters>) next[key] += delta[key] ?? 0;
  return next;
}

/** What one answered provider or Nano call adds to the counters. */
export function usageCounts(usage: Usage): Partial<SessionCounters> {
  if (usage.kind === 'search') return { [SEARCHES[usage.search].counter]: 1 };
  if (usage.onDevice) {
    return { onDeviceCalls: 1, onDeviceTokensIn: usage.tokensIn, onDeviceTokensOut: usage.tokensOut, onDeviceSeconds: usage.seconds ?? 0 };
  }
  return {
    cloudCalls: 1,
    cloudTokensIn: usage.tokensIn,
    cloudTokensOut: usage.tokensOut,
    ...(usage.costUsd === null ? {} : { cloudBilledUsd: usage.costUsd, cloudBilledCalls: 1 }),
  };
}
