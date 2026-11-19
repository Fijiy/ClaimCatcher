// The viewer's settings in chrome.storage.local. Only the service worker uses
// this module: the offscreen document has no chrome.storage, and the panel
// asks the worker through messages.
//
// What's kept: the viewer's consent (given on the first-run page) and the API
// keys: the provider's (Venice), and TinyFish's for local mode's TinyFish
// search. Each key is stored unencrypted (the spec says so, and the first-run
// page and Privacy & data tell the viewer). Storage is restricted to trusted
// extension contexts, so a content script asking for it gets nothing. Each key
// is only ever sent to its own service's origin (session/checks/venice.ts,
// session/checks/tinyfish.ts).

import { browser } from 'wxt/browser';
import { isSearchId, KEYS, keyFor, PROVIDER_SEARCH, searchFor } from './session/searches';
import type { KeyId, Mode, SearchId } from './session/types';

const CONSENT = 'consent';

export type { KeyId };
const STORED_AS: Record<KeyId, string> = { venice: 'apiKey', tinyfish: 'tinyfishKey' };

/** The one provider today (GLOSSARY: private-first provider). */
export type Provider = 'venice';
/** The provider ClaimCatcher sends to now; consent names it. */
export const CURRENT_PROVIDER: Provider = 'venice';

/**
 * What the viewer agreed to on the first-run page: data may go to this
 * provider in this mode. It is also the mode setting: switching mode means
 * agreeing to the new one first, so nothing goes to a new destination before
 * the viewer has approved it (spec story 78).
 */
export interface Consent {
  mode: Mode;
  provider: Provider;
  /**
   * Where the claims are searched: in cloud mode always the provider; in local
   * mode the viewer's choice. Agreed to with the mode, so a new search, like a
   * new mode, is agreed to before anything goes there. Consent given before
   * the choice existed meant the provider's search.
   */
  search: SearchId;
  /** When it was given, ms since epoch. */
  givenAt: number;
}

/** Whether ClaimCatcher may listen: consent given, and what its mode and search need. */
export interface Setup {
  consent: Consent | null;
  /** Each key's status: the provider's (`venice`) and TinyFish's (`tinyfish`, for local mode's TinyFish search). */
  keys: Record<KeyId, KeyStatus>;
}

/** What listening needs, given the consent: for each key, whether it is the one (searches.ts). */
export type Needs = Record<KeyId, boolean>;

export function needsOf(consent: Pick<Consent, 'mode' | 'search'>): Needs {
  const needed = keyFor(consent.mode, consent.search);
  return Object.fromEntries(KEY_IDS.map((key) => [key, key === needed])) as Needs;
}

const KEY_IDS = Object.keys(KEYS) as KeyId[];

/** What's still missing before listening can start, in the order the viewer would fix it; empty when nothing is. */
export function missing(setup: Setup): KeyId[] {
  if (!setup.consent) return [];
  const needs = needsOf(setup.consent);
  return KEY_IDS.filter((key) => needs[key] && !setup.keys[key].hasKey);
}

/** What the panel may know about the key: whether one is set, and its last four characters. */
export interface KeyStatus {
  hasKey: boolean;
  /** e.g. "••••3f9a"; null without a key. */
  masked: string | null;
}

/**
 * Keeps chrome.storage.local away from content scripts (Chrome's default
 * lets them read it). Chrome persists the setting; calling it again is cheap.
 */
export async function restrictStorageToTrustedContexts(): Promise<void> {
  await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

/** A pasted key often brings quotes, a `Bearer ` prefix or stray whitespace. */
export function normalizeApiKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^bearer\s+/i, '')
    .trim();
}

export async function readApiKey(which: KeyId = 'venice'): Promise<string> {
  const stored = await browser.storage.local.get(STORED_AS[which]);
  const key = stored[STORED_AS[which]];
  return typeof key === 'string' ? key : '';
}

export async function saveApiKey(raw: string, which: KeyId = 'venice'): Promise<KeyStatus> {
  const key = normalizeApiKey(raw);
  if (key) await browser.storage.local.set({ [STORED_AS[which]]: key });
  else await browser.storage.local.remove(STORED_AS[which]);
  return keyStatus(which);
}

export async function keyStatus(which: KeyId = 'venice'): Promise<KeyStatus> {
  const key = await readApiKey(which);
  return { hasKey: key !== '', masked: key ? `••••${key.slice(-4)}` : null };
}

export async function forgetApiKey(which: KeyId = 'venice'): Promise<KeyStatus> {
  await browser.storage.local.remove(STORED_AS[which]);
  return keyStatus(which);
}

export async function readConsent(): Promise<Consent | null> {
  const stored = await browser.storage.local.get(CONSENT);
  const consent = stored[CONSENT] as Partial<Consent> | undefined;
  const mode = consent?.mode;
  if ((mode !== 'cloud' && mode !== 'local') || consent?.provider !== CURRENT_PROVIDER || typeof consent.givenAt !== 'number') return null;
  // Before local mode had a choice of search, consent meant the provider's search.
  // Consent to a search no longer offered (DuckDuckGo) is asked for again, never read as another one.
  if (mode === 'local' && consent.search !== undefined && !isSearchId(consent.search)) return null;
  const search = mode === 'local' && consent.search ? consent.search : PROVIDER_SEARCH;
  return { mode, provider: consent.provider, search, givenAt: consent.givenAt };
}

export async function giveConsent(mode: Mode, search: SearchId, now = Date.now()): Promise<Consent> {
  const consent: Consent = { mode, provider: CURRENT_PROVIDER, search: searchFor(mode, search), givenAt: now };
  await browser.storage.local.set({ [CONSENT]: consent });
  return consent;
}

export async function readSetup(): Promise<Setup> {
  const [consent, statuses] = await Promise.all([readConsent(), Promise.all(KEY_IDS.map(keyStatus))]);
  return { consent, keys: Object.fromEntries(KEY_IDS.map((key, i) => [key, statuses[i]!])) as Record<KeyId, KeyStatus> };
}
