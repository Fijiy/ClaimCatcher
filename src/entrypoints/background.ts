// Service worker: a thin router. It turns browser events (icon click,
// Alt+Shift+L, navigation, tab closed, panel opened or closed) into session
// commands, and owns the things only it can touch: the side panel, the
// per-tab LIVE badge, script injection, the offscreen document and
// chrome.storage. It holds no session state of its own: only which tab is
// live, and which tab asked to take over, as tab ids in storage.session.

import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import { pickCaptionReader } from '../captions/pick-reader';
import { onMessage, sendMessage, sendToTab, type SwitchRequest } from '../messages';
import { DESCRIPTION_LIMIT, readPageFacts, type PageFacts } from '../page/page-facts';
import { pauseMedia } from '../page/pause-media';
import { seekMedia } from '../page/seek-media';
import { openPrivacyPage } from '../privacy-page';
import { KEYS, keyFor } from '../session/searches';
import type { CaptionReaderId, PageContext, SessionSettings, StopReason } from '../session/types';
import {
  forgetApiKey,
  giveConsent,
  needsOf,
  readApiKey,
  readConsent,
  readSetup,
  restrictStorageToTrustedContexts,
  saveApiKey,
} from '../settings';

const OFFSCREEN_URL = '/offscreen.html';
/** The scripts each caption reader injects, in order. The House player object is only reachable from the MAIN world. */
const READER_SCRIPTS: Record<CaptionReaderId, Array<{ file: ScriptPublicPath; world?: 'MAIN' }>> = {
  track: [{ file: '/content-scripts/track-reader.js' }],
  youtube: [{ file: '/content-scripts/youtube-reader.js' }],
  house: [{ file: '/content-scripts/house-reader.js' }, { file: '/content-scripts/house-player.js', world: 'MAIN' }],
};
/** Captures the page's audio for the on-device transcript, on every page, captions or not. */
const AUDIO_CAPTURE_SCRIPT: ScriptPublicPath = '/content-scripts/audio-capture.js';
const PILL: ScriptPublicPath = '/content-scripts/pill.js';
/**
 * What the worker keeps in storage.session (memory only, so it survives
 * worker restarts): ids and one media time, never session data.
 */
interface Kept {
  listeningTabId: number;
  switchToTabId: number;
  /** Windows whose side panel is open. */
  panelWindowIds: number[];
  /** Tab id -> media time: a blocked player's page reopened in a new tab. */
  reopenedAt: Record<string, number>;
}
const isNumber = (value: unknown): value is number => typeof value === 'number';
const KEPT: { [K in keyof Kept]: (value: unknown) => value is Kept[K] } = {
  listeningTabId: isNumber,
  switchToTabId: isNumber,
  panelWindowIds: (value): value is number[] => Array.isArray(value) && value.every(isNumber),
  reopenedAt: (value): value is Record<string, number> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(isNumber),
};

/** One kept value, if it is there and has the right shape. */
async function kept<K extends keyof Kept>(key: K): Promise<Kept[K] | undefined> {
  const value = (await browser.storage.session.get(key))[key];
  return KEPT[key](value) ? value : undefined;
}

/** Keeps a value, or forgets it (`undefined`). */
async function keep<K extends keyof Kept>(key: K, value: Kept[K] | undefined) {
  if (value === undefined) await browser.storage.session.remove(key);
  else await browser.storage.session.set({ [key]: value });
}

export default defineBackground(() => {
  // Before anything is stored: content scripts must never read the API key.
  void restrictStorageToTrustedContexts().catch((error: unknown) => console.error('[ClaimCatcher] storage access level', error));

  // The first-run page: Chrome's in-extension consent. Nothing listens until
  // the viewer agrees there and sets a key.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void openPrivacyPage().catch((error: unknown) => console.error('[ClaimCatcher] first-run page', error));
  });

  // The icon click must open the panel itself (below), so Chrome must not.
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  // Also fires for Alt+Shift+L: the manifest binds it to `_execute_action`.
  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    // Before any await: sidePanel.open() needs the click's user gesture.
    browser.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => console.error('[ClaimCatcher] sidePanel.open', error));
    void serially(() => clicked(tab));
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void serially(async () => {
      if ((await switchRequest())?.tabId === tabId) await setSwitchRequest(null);
      await takeReopenedAt(tabId);
      if ((await listeningTab()) === tabId) await stopListening('tab-closed');
    });
  });

  // Navigation. The readers and the pill die with each page, and Chrome
  // clears the badge, so a new page on the same site gets them back (a
  // pushState navigation also ends in `complete`, so a new video in a
  // single-page player is re-attached too). A move to another origin ends the
  // click's activeTab grant: the tab's URL is hidden from us from the first
  // update after it commits, and listening stops there.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    void serially(async () => {
      if ((await listeningTab()) !== tabId) return;
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      if (!tab?.url) return stopListening('left-site');
      if (change.status === 'complete') await reattach(tabId, await pageOf(tab));
    });
  });

  // The pill shows only while the panel is hidden in the live tab's window.
  browser.sidePanel.onOpened.addListener(({ windowId }) => void panelShown(windowId, true));
  browser.sidePanel.onClosed.addListener(({ windowId }) => void panelShown(windowId, false));
  browser.tabs.onAttached.addListener((tabId) => {
    void (async () => {
      if ((await listeningTab()) !== tabId) return;
      const { windowId } = await browser.tabs.get(tabId);
      await tellPill(windowId, await panelShownIn(windowId));
    })().catch(() => {});
  });

  onMessage('background', {
    'stop-listening': () => serially(() => stopListening('viewer')),
    'get-setup': () => readSetup(),
    // A mode or search switch: the viewer has just agreed to the new
    // destination. A session still sending to the old one stops; the next
    // uses the new one.
    'give-consent': ({ mode, search }) =>
      serially(async () => {
        const before = await readConsent();
        const after = await giveConsent(mode, search);
        if (before && before.mode !== after.mode) await endSession('mode-changed');
        else if (before && before.search !== after.search) await endSession('search-changed');
        return readSetup();
      }),
    // Saving a different key also ends a session using the old one, as
    // Forget key does: a stopped session never checks again with a replaced key.
    'save-api-key': ({ key, which = 'venice' }) =>
      serially(async () => {
        const before = await readApiKey(which);
        await saveApiKey(key, which);
        const consent = await readConsent();
        if (before && consent && needsOf(consent)[which] && (await readApiKey(which)) !== before) await endSession('key-changed');
        return readSetup();
      }),
    // Forgetting a key also ends a session that is using it.
    'forget-api-key': ({ which = 'venice' }) =>
      serially(async () => {
        await forgetApiKey(which);
        const consent = await readConsent();
        if (!consent || needsOf(consent)[which]) await endSession(KEYS[which].missing);
        return readSetup();
      }),
    replay: ({ tabId, time }) => replay(tabId, time),
    'listen-again': ({ tabId }) => serially(() => listenAgain(tabId)),
    'get-switch-request': () => switchRequest(),
    'answer-switch': ({ confirm }) => serially(() => answerSwitch(confirm)),
    // From the pill's button: its click is still a user gesture here, as long
    // as nothing is awaited first.
    'show-panel': (_, sender) => {
      if (sender.tab?.id === undefined) return;
      browser.sidePanel.open({ tabId: sender.tab.id }).catch((error: unknown) => console.error('[ClaimCatcher] sidePanel.open', error));
    },
    'get-panel-shown': (_, sender) => (sender.tab ? panelShownIn(sender.tab.windowId) : true),
    // The session stopped on its own (the provider refused the key, or it has
    // no credit): end capture too. A no-op if listening already stopped.
    'session-stopped': ({ tabId, reason }) =>
      serially(async () => {
        if ((await listeningTab()) === tabId) await stopListening(reason);
      }),
    // After Allow on a blocked player: its page again, in a new tab where tabCapture works.
    'reopen-in-new-tab': ({ tabId }) => serially(() => reopenInNewTab(tabId)),
    // The offscreen document holds a stopped session until Clear now or a new
    // session (the panel may be closed and opened again meanwhile). Cleared,
    // it can go, unless a new session has started in it since.
    'session-cleared': () =>
      serially(async () => {
        if ((await listeningTab()) === undefined) await closeOffscreenDocument();
      }),
  });
});

// One start or stop at a time, so a double click can't start two sessions.
let queue: Promise<unknown> = Promise.resolve();
function serially<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch((error: unknown) => console.error('[ClaimCatcher]', error));
  return run;
}

/** The icon was clicked (or Alt+Shift+L pressed) on `tab`. */
async function clicked(tab: Browser.tabs.Tab) {
  const tabId = tab.id!;
  const current = await listeningTab();
  if (current === tabId) return; // already listening here; the click just showed the panel
  // No consent or no key, no listening; in local mode, not before Gemini Nano
  // is on the device either. The panel, opened by this click, says why.
  if (!(await usableSettings())) return;
  // One tab at a time: the panel asks "Stop listening on <first tab> and listen here?".
  if (current !== undefined) return setSwitchRequest({ tabId });
  await startListening(tabId, await pageOf(tab));
}

/** The viewer answered "Stop listening on <first tab> and listen here?". */
async function answerSwitch(confirm: boolean) {
  const request = await switchRequest();
  await setSwitchRequest(null);
  if (!confirm || !request) return;
  // The click on that tab granted activeTab, so its URL and title are readable.
  const tab = await browser.tabs.get(request.tabId).catch(() => undefined);
  if (!tab?.url) return;
  await stopListening('viewer');
  await startListening(request.tabId, await pageOf(tab));
}

/**
 * Listen again, from the panel. A click in the panel grants nothing, so this
 * works only while the icon click's grant on that tab lasts: until the tab
 * moves to another site or closes. Answers whether listening started.
 */
async function listenAgain(tabId: number): Promise<boolean> {
  if ((await listeningTab()) !== undefined) return false;
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (!tab?.url) return false;
  return startListening(tabId, await pageOf(tab));
}

/**
 * The mode, search and key to listen with, if the viewer has agreed to a mode
 * and search and has what they need: the provider's key (cloud mode, or local
 * mode searching there) or a TinyFish key; and, in local mode, Gemini Nano
 * on the device.
 */
async function usableSettings(): Promise<SessionSettings | undefined> {
  const consent = await readConsent();
  if (!consent) return undefined;
  // Only the key the mode and search use goes to the session.
  const key = await readApiKey(keyFor(consent.mode, consent.search));
  if (!key) return undefined;
  if (consent.mode === 'local' && !(await localModelReady())) return undefined;
  return { mode: consent.mode, search: consent.search, key };
}

async function startListening(tabId: number, page: PageContext): Promise<boolean> {
  const settings = await usableSettings();
  if (!settings) return false;
  await setSwitchRequest(null);
  await ensureOffscreenDocument();
  await sendMessage({ to: 'offscreen', type: 'start-session', tabId, page, settings });
  await keep('listeningTabId', tabId);
  await setLiveBadge(tabId, true);
  try {
    await attach(tabId, page.url);
    // A blocked player's page opened again: carry on from the same moment.
    const at = await takeReopenedAt(tabId);
    if (at !== undefined) await browser.scripting.executeScript({ target: { tabId }, func: seekMedia, args: [at] }).catch(() => {});
    return true;
  } catch (error) {
    console.error('[ClaimCatcher] could not inject the caption reader', error);
    await stopListening('page-unavailable');
    return false;
  }
}

/** A new page on the same site: the session carries on, and capture comes back. */
async function reattach(tabId: number, page: PageContext) {
  await setLiveBadge(tabId, true); // Chrome cleared it with the old page
  await sendMessage({ to: 'offscreen', type: 'page-changed', tabId, page }).catch(() => {});
  try {
    await attach(tabId, page.url);
  } catch (error) {
    console.error('[ClaimCatcher] could not re-attach to the new page', error);
    await stopListening('page-unavailable');
  }
}

/**
 * Puts the caption reader for `url`, the audio capture and the pill into the tab. Runs under the
 * click's activeTab grant, which also reveals the URL; nothing is declared to
 * run on every page. Injecting again replaces earlier copies, so this is also
 * how a new page is re-attached (with the reader for the new URL).
 */
async function attach(tabId: number, url: string) {
  for (const { file, world } of READER_SCRIPTS[pickCaptionReader(url)]) {
    await browser.scripting.executeScript({ target: { tabId }, files: [file], world });
  }
  await browser.scripting.executeScript({ target: { tabId }, files: [AUDIO_CAPTURE_SCRIPT] });
  await browser.scripting.executeScript({ target: { tabId }, files: [PILL] });
}

async function stopListening(reason: StopReason) {
  const tabId = await listeningTab();
  if (tabId === undefined) return;
  await keep('listeningTabId', undefined);
  // Capture ends first. The tab may be gone, or on another site by now.
  await sendToTab(tabId, { to: 'reader', type: 'stop-reading' }).catch(() => {});
  await sendToTab(tabId, { to: 'pill', type: 'remove-pill' }).catch(() => {});
  await setLiveBadge(tabId, false).catch(() => {});
  // The session stops at once; the checks already running still reach a
  // label, and its document keeps the stopped session until Clear now or a
  // new session.
  await sendMessage({ to: 'offscreen', type: 'stop-session', reason }).catch(() => {});
}

/**
 * The settings a session was started with are no longer agreed to (Forget
 * key, a mode switch): listening stops, and a stopped session kept for the
 * panel sends nothing more with them.
 */
async function endSession(reason: StopReason) {
  await stopListening(reason);
  await sendMessage({ to: 'offscreen', type: 'settings-withdrawn' }).catch(() => {});
}

/** The page's context: title, URL and what the page says about its video, read under the activeTab grant. */
async function pageOf(tab: Browser.tabs.Tab): Promise<PageContext> {
  const facts = await readFacts(tab.id!);
  // The page's own title (YouTube's heading is current after it navigates in place), else the tab's.
  return { url: tab.url ?? '', ...facts, title: facts.title ?? tab.title ?? '' };
}

/**
 * What the page says about its video (title, channel, description, recording
 * date), read under the click's activeTab grant. Only strings are kept.
 */
async function readFacts(tabId: number): Promise<PageFacts> {
  try {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: readPageFacts });
    const read = (injection?.result ?? {}) as Record<string, unknown>;
    const facts: PageFacts = {};
    for (const key of ['title', 'channel', 'description', 'recordedOn'] as const) {
      const value = read[key];
      if (typeof value === 'string' && value.trim()) facts[key] = key === 'description' ? value.slice(0, DESCRIPTION_LIMIT) : value;
    }
    return facts;
  } catch {
    return {}; // the page can't be read; listening will say so when the reader can't be injected
  }
}

/** Seeks the listened video, through the activeTab grant the icon click gave on that tab. */
async function replay(tabId: number, time: number): Promise<boolean> {
  if (!Number.isFinite(time)) return false;
  try {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: seekMedia, args: [time] });
    return injection?.result === true;
  } catch (error) {
    // The grant ends when the tab goes to another site or closes.
    console.error('[ClaimCatcher] replay', error);
    return false;
  }
}

/**
 * After Allow: the blocked player's page again, in a new tab beside it, where
 * the next icon click grants tabCapture. The old tab's video is paused, and
 * the new one seeks to the same moment when listening starts there.
 * Listening here stops, so that click doesn't ask to switch tabs.
 */
async function reopenInNewTab(tabId: number): Promise<boolean> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (!tab?.url) return false;
  const [paused] = await browser.scripting.executeScript({ target: { tabId }, func: pauseMedia }).catch(() => []);
  const at = typeof paused?.result === 'number' ? paused.result : null;
  const opened = await browser.tabs.create({ url: tab.url, index: tab.index + 1, windowId: tab.windowId, openerTabId: tabId, active: true });
  if (opened.id !== undefined && at !== null) await keep('reopenedAt', { ...(await kept('reopenedAt')), [opened.id]: at });
  if ((await listeningTab()) === tabId) await stopListening('reopened');
  return true;
}

/** Where a reopened tab's video should start, once; undefined for any other tab. */
async function takeReopenedAt(tabId: number): Promise<number | undefined> {
  const { [String(tabId)]: at, ...rest } = (await kept('reopenedAt')) ?? {};
  if (at === undefined) return undefined;
  await keep('reopenedAt', rest);
  return at;
}

function listeningTab(): Promise<number | undefined> {
  return kept('listeningTabId');
}

async function switchRequest(): Promise<SwitchRequest | null> {
  const tabId = await kept('switchToTabId');
  return tabId === undefined ? null : { tabId };
}

async function setSwitchRequest(request: SwitchRequest | null) {
  await keep('switchToTabId', request?.tabId);
  // An open panel shows (or drops) the question; one opening later asks.
  await sendMessage({ to: 'panel', type: 'switch-request', request }).catch(() => {});
}

// Side panel contexts don't say which window they're in (windowId is -1), so
// the open/closed events are tracked per window.
async function panelShown(windowId: number, shown: boolean) {
  const open = new Set(await kept('panelWindowIds'));
  if (shown) open.add(windowId);
  else open.delete(windowId);
  await keep('panelWindowIds', [...open]);
  await tellPill(windowId, shown);
}

async function panelShownIn(windowId: number): Promise<boolean> {
  const panels = await browser.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
  if (panels.length === 0) return false;
  return (await kept('panelWindowIds'))?.includes(windowId) === true;
}

/** Tells the pill on the live tab whether the panel is showing, if the change is in its window. */
async function tellPill(windowId: number, shown: boolean) {
  const tabId = await listeningTab();
  if (tabId === undefined) return;
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (tab?.windowId !== windowId) return;
  await sendToTab(tabId, { to: 'pill', type: 'panel-shown', shown }).catch(() => {});
}

async function setLiveBadge(tabId: number, live: boolean) {
  await browser.action.setBadgeText({ tabId, text: live ? 'LIVE' : '' });
  if (live) {
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#c8321f' });
    await browser.action.setBadgeTextColor({ tabId, color: '#ffffff' });
  }
}

/**
 * Whether Gemini Nano is ready for local mode. Only the offscreen document can
 * ask Chrome (the worker has no LanguageModel), so it is created to ask, and
 * closed again if nothing else needs it.
 */
async function localModelReady(): Promise<boolean> {
  const existed = await hasOffscreenDocument();
  await ensureOffscreenDocument();
  const model = await sendMessage({ to: 'offscreen', type: 'get-local-model' }).catch(() => null);
  const ready = model?.state === 'available';
  if (!ready && !existed) await closeOffscreenDocument();
  return ready;
}

async function hasOffscreenDocument() {
  const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'WORKERS'],
    justification: 'Runs the listening session: tab audio, the transcript and on-device models.',
  });
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) await browser.offscreen.closeDocument();
}
