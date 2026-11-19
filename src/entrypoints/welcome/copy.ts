// What the first-run page and Privacy & data say is sent, and to whom, per
// mode. The wording comes from the map's tickets #11 and #12 and spec stories
// 3 and 4; keep it word for word in step with them.

import { keyFor } from '../../session/searches';
import type { Mode, SearchId } from '../../session/types';

/** The provider as the page names it, and where the viewer manages keys. */
export const PROVIDER = {
  name: 'Venice',
  keysUrl: 'https://venice.ai/settings/api',
} as const;

/** Local mode first: it is preselected wherever Chrome can run Gemini Nano. */
export const MODES: readonly Mode[] = ['local', 'cloud'];

export const modeName: Record<Mode, string> = {
  cloud: 'Cloud mode',
  local: 'Local mode',
};

/** What leaves the device in each mode. */
export const sends: Record<Mode, string> = {
  local: `Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to ${PROVIDER.name} to find sources.`,
  cloud:
    `Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to ${PROVIDER.name}'s search to find sources, ` +
    `and each claim, with about 30 seconds of what was said before it and the page's title and channel, is sent to ${PROVIDER.name} to be judged.`,
};

/** Who judges the claims in each mode. */
export const judgedBy: Record<Mode, string> = {
  local: "Claims are judged on this device by Gemini Nano, the model built into Google Chrome. It comes from Chrome itself, not from ClaimCatcher.",
  cloud: `Claims are judged by an AI model at ${PROVIDER.name}, using only models that keep nothing and train on nothing.`,
};

// ---- Local mode's search (ticket #45) ---------------------------------------

// The searches themselves (names, policies, the order offered, the default)
// are in session/searches.ts; this is what the page says about each.

/** Where TinyFish keys are made. */
export const TINYFISH_KEYS_URL = 'https://agent.tinyfish.ai/api-keys';

/**
 * What leaves the device in local mode, for each search: where the queries go
 * and under whose policy. TinyFish's policy says nothing about search queries,
 * and its API lists every search back on the account (`GET /usage`, with the
 * query; checked 2026-10-26).
 */
export const localSends: Record<SearchId, string> = {
  venice: sends.local,
  tinyfish:
    "Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to TinyFish's search to find sources, " +
    "under TinyFish's privacy policy. TinyFish keeps a record of each search on your TinyFish account and makes no promise about how long it keeps search queries.",
};

/** What each search needs from the viewer. */
export const searchNeeds: Record<SearchId, string> = {
  tinyfish: 'Free, with a free TinyFish API key: no payment details, up to 500 searches an hour.',
  venice: `Needs your ${PROVIDER.name} API key, which pays for each search (about $0.01).`,
};

/** What leaves the device, given the mode and (in local mode) the search. */
export function sendsFor(mode: Mode, search: SearchId): string {
  return mode === 'cloud' ? sends.cloud : localSends[search];
}

/** What checking costs, given the mode and search. */
export function costFor(mode: Mode, search: SearchId): string {
  if (keyFor(mode, search) === 'venice') {
    return `You pay ${PROVIDER.name} directly, with your own API key. Checking costs about $1–2 per hour of video. You set the spending limit on the key at ${PROVIDER.name}.`;
  }
  return "Nothing. Gemini Nano runs on this device, and TinyFish's search is free with a free key (up to 500 searches an hour).";
}

/** Which key goes where, given the mode and search. */
export function keyGoesFor(mode: Mode, search: SearchId): string {
  if (keyFor(mode, search) === 'venice') return `Your API key goes with each request to ${PROVIDER.name}, and nowhere else.`;
  return 'Your TinyFish API key goes with each search to TinyFish, and nowhere else.';
}

/** What happens after the viewer agrees, on the first run. */
export function afterAgreeing(mode: Mode, search: SearchId): string {
  if (keyFor(mode, search) === 'venice') return `After you agree, you'll set up your ${PROVIDER.name} key.`;
  return "After you agree, you'll set up your free TinyFish key.";
}
