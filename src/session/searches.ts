// The searches ClaimCatcher can send the claims' queries to (GLOSSARY:
// search), and the keys they need: one registry, which everything else reads
// (settings, the session, the first-run page, the counters and the footprint).
// Cloud mode always searches at the provider; local mode at the viewer's
// choice, never more than one, and never a quiet switch to another.

import type { SearchProvider, UsageListener } from './checks/provider';
import { createTinyFishSearch } from './checks/tinyfish';
import type { KeyId, Mode, SearchId, SessionCounters, StopReason } from './types';

/** A key the viewer can set, and the stops that name it. */
export interface KeyInfo {
  /** The service the key belongs to, and the only one it is sent to. */
  service: string;
  /** Listening stops with this when the key is missing (none set, or forgotten). */
  missing: StopReason;
}

export const KEYS: Record<KeyId, KeyInfo> = {
  venice: { service: 'Venice', missing: 'no-key' },
  tinyfish: { service: 'TinyFish', missing: 'no-search-key' },
};

/** What a search adapter is made from. */
export interface SearchDeps {
  fetch: typeof fetch;
  /** The key this search needs (`SearchInfo.key`). */
  key: string;
  onUsage: UsageListener;
  /** The provider's own search, already made with the provider's key. */
  providerSearch: SearchProvider;
}

export interface SearchInfo {
  /** As the viewer reads it. */
  name: string;
  /** The key listening needs with this search (local mode judges on the device, so only this one). */
  key: KeyId;
  /** The counter its answered requests go on. */
  counter: keyof SessionCounters;
  policy: string;
  policyUrl: string;
  /** Its adapter. */
  create(deps: SearchDeps): SearchProvider;
}

export const SEARCHES: Record<SearchId, SearchInfo> = {
  tinyfish: {
    name: 'TinyFish',
    key: 'tinyfish',
    counter: 'tinyfishSearches',
    policy: "TinyFish's privacy policy",
    policyUrl: 'https://www.tinyfish.ai/privacy-policy',
    create: ({ fetch, key, onUsage }) => createTinyFishSearch(fetch, key, { onUsage }),
  },
  venice: {
    name: 'Venice',
    key: 'venice',
    counter: 'veniceSearches',
    policy: "Venice's privacy policy",
    policyUrl: 'https://venice.ai/privacy',
    create: ({ providerSearch }) => providerSearch,
  },
};

/** Local mode's searches, in the order the first-run page offers them. */
export const LOCAL_SEARCHES: readonly SearchId[] = ['tinyfish', 'venice'];

/** Preselected for local mode: free, with no payment details. */
export const DEFAULT_LOCAL_SEARCH: SearchId = 'tinyfish';

/** Cloud mode's search: the provider's. Also what local mode meant before it had a choice. */
export const PROVIDER_SEARCH: SearchId = 'venice';

export function isSearchId(value: unknown): value is SearchId {
  return typeof value === 'string' && Object.hasOwn(SEARCHES, value);
}

/** Where the claims are searched, given the mode and (in local mode) the viewer's choice. */
export function searchFor(mode: Mode, chosen: SearchId | undefined): SearchId {
  return mode === 'cloud' ? PROVIDER_SEARCH : (chosen ?? PROVIDER_SEARCH);
}

/** The key listening needs, given the mode and search. */
export function keyFor(mode: Mode, chosen: SearchId | undefined): KeyId {
  return SEARCHES[searchFor(mode, chosen)].key;
}
