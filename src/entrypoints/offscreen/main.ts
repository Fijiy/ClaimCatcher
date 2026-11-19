// Offscreen document: owns the session. It wires the session module to the
// platform (real clock, runtime messages) and does nothing else; behaviour
// belongs in src/session, where it is tested.
//
// Created by the service worker when listening starts. After Stop it keeps
// the stopped session (in memory only), so the checks in flight reach a
// label, the panel can be closed and opened again without losing it, and
// "Who said this?" can still be answered. A new session replaces it; Clear
// now on a stopped session tells the service worker (`session-cleared`),
// which closes the document. Only `chrome.runtime` is available here. It starts the on-device model worker
// (src/models), which lives and dies with it.
//
// The tab's audio arrives here and never goes further than the model worker:
// each audio source feeds PCM frames to a transcriber (src/audio), whose
// on-device transcript segments and "audio flowing" go to the session. The
// first source is the page's media element (captureStream() in the tab, over
// a port). When the page reports that its player blocks that, the session
// says so; the panel then gets a tabCapture stream ID if the viewer has
// allowed it (straight away) and sends it here, where the tab's audio is
// opened and feeds `transcriberFor` the same way. Every input says which
// source it came from; the session decides which is heard. While the session wants
// voices told apart, the transcriber also runs voice separation on each piece
// of audio, whichever source it came from (one set of voices per tab, until
// its next page), and the voice turns go to the session too.

import { browser, type Browser } from 'wxt/browser';
import { decodePcm, MODEL_RATE } from '../../audio/pcm';
import { AUDIO_PORT, type PageAudioMessage } from '../../audio/port';
import { captureTabAudio } from '../../audio/tab-audio';
import { createTabClock, type TabClock } from '../../audio/tab-clock';
import { createTranscriber, type Transcriber } from '../../audio/transcriber';
import { onMessage, sendMessage } from '../../messages';
import { checkLocalModel, chromeLanguageModel } from '../../local-model';
import { createClaimFilter } from '../../models/claim-filter';
import { startModelWorker } from '../../models/client';
import { createSpeechToText } from '../../models/speech-to-text';
import { createVoiceSeparation, type VoiceSeparation } from '../../models/voice-separation';
import { createSession, type Session } from '../../session/session';
import type { AudioSource, Clock } from '../../session/types';
import { emptyView } from '../../session/view';

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let session: Session | undefined;
let unsubscribe = () => {};
/** Set while the router itself is stopping the session, so it isn't told back. */
let stopping = false;

// Started now, so the claim filter has loaded by the time the first sentence arrives.
const models = startModelWorker();
const claimFilter = createClaimFilter(models);
claimFilter.warm().catch((error: unknown) => {
  console.warn('[ClaimCatcher] the claim filter did not load; every sentence will be checked', error);
});
const speechToText = createSpeechToText(models);
speechToText.warm().catch((error: unknown) => {
  console.warn('[ClaimCatcher] speech-to-text did not load; only captions will be read', error);
});

/** Voice ids never repeat while this document lives, so a forgotten voice can't come back as someone else. */
let voiceCount = 0;
const newVoiceId = () => `voice-${++voiceCount}`;
/** Each tab's voices, until its next page. */
const tabVoices = new Map<number, VoiceSeparation>();
function voicesFor(tabId: number): VoiceSeparation {
  let voices = tabVoices.get(tabId);
  if (!voices) tabVoices.set(tabId, (voices = createVoiceSeparation(models, newVoiceId)));
  return voices;
}
/** Whether the session wants voices told apart (its `voice-separation` events). */
let separatingVoices = false;
const transcribers = new Set<Transcriber>();

/**
 * A transcriber for one tab's audio, reporting to the session. Every audio
 * source feeds one, and says which it is: the session decides whose audio is
 * heard (while tabCapture runs, not the page's).
 */
function transcriberFor(tabId: number, from: AudioSource = 'page'): Transcriber {
  const transcriber = createTranscriber({
    clock: systemClock,
    transcribe: (samples) => speechToText.transcribe(samples),
    onSegment: (segment) => session?.dispatch({ type: 'on-device-segment', tabId, segment, from }),
    onFlowing: (flowing) => session?.dispatch({ type: 'audio', tabId, flowing, from }),
    onTranscribed: (seconds) => session?.dispatch({ type: 'speech-to-text', tabId, seconds, from }),
    separate: async (samples, time) => {
      const span = { start: time, end: time + samples.length / MODEL_RATE };
      try {
        const separated = await voicesFor(tabId).separate(samples, time);
        session?.dispatch({ type: 'voices', tabId, from, ...separated });
        return separated.turns;
      } catch (error) {
        // The stretch has no voices; checks waiting for it go on without one.
        session?.dispatch({ type: 'voices', tabId, from, span, turns: [], failed: true });
        throw error;
      }
    },
  });
  transcriber.separateVoices(separatingVoices);
  const tracked: Transcriber = {
    ...transcriber,
    close() {
      transcriber.close();
      transcribers.delete(tracked);
    },
  };
  transcribers.add(tracked);
  return tracked;
}

function separateVoices(on: boolean) {
  separatingVoices = on;
  for (const transcriber of transcribers) transcriber.separateVoices(on);
}

const capturePorts = new Map<number, Browser.runtime.Port>();

/** The tab captured with tabCapture, once its blocked player has fallen back to it; one at a time. */
let tabAudio: { tabId: number; stop: () => void } | null = null;
/** Each tab's player time, reported by the page, for tabCapture frames. */
const tabClocks = new Map<number, TabClock>();
function tabClockFor(tabId: number): TabClock {
  let clock = tabClocks.get(tabId);
  if (!clock) tabClocks.set(tabId, (clock = createTabClock()));
  return clock;
}

function stopTabAudio() {
  tabAudio?.stop();
  tabAudio = null;
}

const listeningOn = (tabId: number) => {
  const status = session?.snapshot().status;
  return status?.state === 'listening' && status.tabId === tabId;
};

/**
 * tabCapture for a blocked player, from a stream ID the panel got (it does
 * that straight away when the viewer has allowed tabCapture). The tab's audio
 * then feeds a transcriber like the page's player did. Answers whether the
 * tab is captured now.
 */
async function useTabStream(tabId: number, streamId: string): Promise<boolean> {
  if (!listeningOn(tabId)) return false;
  if (tabAudio?.tabId === tabId) return true;
  stopTabAudio();
  const transcriber = transcriberFor(tabId, 'tab');
  try {
    const stopCapture = await captureTabAudio(streamId, tabClockFor(tabId), {
      frame: (sampleRate, samples, time) => transcriber.push({ sampleRate, samples, time }),
      ended: () => {
        if (tabAudio?.tabId !== tabId) return;
        tabAudio = null;
        transcriber.close();
        session?.dispatch({ type: 'audio', tabId, flowing: false, from: 'tab' });
        // The page's own player is heard again.
        session?.dispatch({ type: 'audio-capture', tabId, capture: { via: 'page' } });
      },
    });
    if (!listeningOn(tabId)) {
      stopCapture();
      transcriber.close();
      return false;
    }
    tabAudio = {
      tabId,
      stop() {
        stopCapture();
        transcriber.close();
      },
    };
  } catch (error) {
    transcriber.close();
    console.warn("[ClaimCatcher] tab audio capture didn't start", error);
    return false;
  }
  session?.dispatch({ type: 'audio-capture', tabId, capture: { via: 'tab' } });
  return true;
}

// Audio source 1: the page's media element, captured in the tab (src/audio/page-audio.ts).
browser.runtime.onConnect.addListener((port: Browser.runtime.Port) => {
  if (port.name !== AUDIO_PORT) return;
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return port.disconnect();
  // A new page (or a re-injection) connects again before the old port has
  // closed; only the newest one speaks for the tab.
  capturePorts.set(tabId, port);
  const transcriber = transcriberFor(tabId);
  port.onMessage.addListener((message: PageAudioMessage) => {
    if (capturePorts.get(tabId) !== port) return;
    switch (message.type) {
      case 'pcm': {
        const samples = decodePcm(message.data);
        // tabCapture already hears the whole tab; the page's player only gives
        // the time (and isn't transcribed a second time).
        if (tabAudio?.tabId === tabId) return tabClockFor(tabId).playerAt(message.time + samples.length / message.sampleRate);
        transcriber.push({ sampleRate: message.sampleRate, samples, time: message.time });
        return;
      }
      case 'player-time':
        return tabClockFor(tabId).playerAt(message.time);
      case 'capture-failed':
        console.warn(`[ClaimCatcher] the player blocks direct listening (${message.failure}): ${message.message}`);
        return session?.dispatch({ type: 'audio-capture', tabId, capture: { via: 'blocked', why: message.failure } });
    }
  });
  port.onDisconnect.addListener(() => {
    transcriber.close();
    if (capturePorts.get(tabId) !== port) return;
    capturePorts.delete(tabId);
    session?.dispatch({ type: 'audio', tabId, flowing: false, from: 'page' });
  });
});

// Events go to the panel one at a time, in order. The panel may be closed, in
// which case nobody answers and that's fine: it catches up from a snapshot.
let outbox: Promise<unknown> = Promise.resolve();

onMessage('offscreen', {
  'start-session': ({ tabId, page, settings }) => {
    // A session still finishing its last checks gives way to the new one.
    unsubscribe();
    stopTabAudio();
    tabClocks.clear();
    // The provider is called from here, and only through the session. Local
    // mode's Gemini Nano runs here too (Google Chrome only; never in a worker).
    const started = createSession({
      clock: systemClock,
      fetch: (input, init) => fetch(input, init),
      claimFilter,
      languageModel: chromeLanguageModel(),
      separatesVoices: true,
    });
    session = started;
    separateVoices(false);
    tabVoices.delete(tabId);
    unsubscribe = started.subscribe((event) => {
      outbox = outbox.then(() => sendMessage({ to: 'panel', type: 'session-event', event })).catch(() => {});
      if (event.type === 'voice-separation') separateVoices(event.on);
      // Two voices given one name: voice separation treats them as one from now on.
      if (event.type === 'voice' && event.voice.sameAs) tabVoices.get(tabId)?.merge(event.voice.id, event.voice.sameAs);
      // It stopped itself (a refused key, no credit): capture has to end too,
      // and the router does that.
      if (event.type === 'stopped' && !stopping) {
        sendMessage({ to: 'background', type: 'session-stopped', tabId, reason: event.reason }).catch(() => {});
      }
    });
    started.dispatch({ type: 'start', tabId, page, settings });
  },
  caption: ({ segment }, sender) => {
    if (sender.tab?.id === undefined) return;
    session?.dispatch({ type: 'caption', tabId: sender.tab.id, segment });
  },
  'page-changed': ({ tabId, page }) => {
    tabVoices.get(tabId)?.reset();
    session?.dispatch({ type: 'page', tabId, page });
  },
  'get-snapshot': () => session?.snapshot() ?? emptyView,
  'clear-session': async () => {
    session?.dispatch({ type: 'clear' });
    await outbox;
    const cleared = session?.snapshot() ?? emptyView;
    // A stopped session, emptied: this document has nothing left to keep.
    if (cleared.status.state === 'stopped') sendMessage({ to: 'background', type: 'session-cleared' }).catch(() => {});
    return cleared;
  },
  'force-check': ({ lineId }) => session?.dispatch({ type: 'force-check', lineId }),
  'speaker-answer': ({ cardId, name }) => session?.dispatch({ type: 'speaker-answer', cardId, name }),
  'voice-name': ({ voice, name }) => session?.dispatch({ type: 'voice-name', voice, name }),
  'voice-skip': ({ voice }) => session?.dispatch({ type: 'voice-skip', voice }),
  'separate-voices': () => session?.dispatch({ type: 'separate-voices' }),
  'get-model-runtime': () => models.runtime().catch(() => null),
  'get-local-model': () => checkLocalModel(),
  'source-opened': ({ url }) => session?.dispatch({ type: 'source-opened', url }),
  'use-tab-stream': ({ tabId, streamId }) => useTabStream(tabId, streamId),
  'settings-withdrawn': () => session?.dispatch({ type: 'settings-withdrawn' }),
  'stop-session': async ({ reason }) => {
    // tabCapture would carry on across navigation, so it has to be ended here.
    stopTabAudio();
    stopping = true;
    try {
      session?.dispatch({ type: 'stop', reason });
    } finally {
      stopping = false;
    }
    await outbox; // the panel hears "stopped" at once; the last checks follow
    return session?.snapshot() ?? emptyView;
  },
});
