import { NO_COUNTS } from './counters';
import type { AfterStop, Card, SessionEvent, SessionView, StopReason, Voice, VoiceId } from './types';

export const emptyView: SessionView = {
  sessionId: null,
  seq: 0,
  status: { state: 'idle' },
  lines: [],
  cards: [],
  opened: [],
  transcriptSource: 'captions',
  voiceSeparation: false,
  voices: [],
  audioCapture: { via: 'page' },
  counters: NO_COUNTS,
};

/**
 * Folds one session event into a view. The session keeps its own view with
 * this, and the side panel mirrors it with the same function, so both always
 * agree. Pure: returns a new view and never mutates its input.
 */
export function applyEvent(view: SessionView, event: SessionEvent): SessionView {
  const next = { ...view, sessionId: event.sessionId, seq: event.seq };
  switch (event.type) {
    case 'started':
      return {
        ...next,
        status: { state: 'listening', tabId: event.tabId, page: event.page, startedAt: event.startedAt },
        lines: [],
        cards: [],
        opened: [],
        transcriptSource: 'captions',
        voiceSeparation: false,
        voices: [],
        audioCapture: { via: 'page' },
        counters: NO_COUNTS,
      };
    case 'line':
      return { ...next, lines: [...view.lines, event.line] };
    case 'line-skipped':
      return {
        ...next,
        lines: view.lines.map((line) =>
          line.id === event.lineId ? { ...line, skipped: [...(line.skipped ?? []), ...event.parts] } : line,
        ),
      };
    case 'card':
      return { ...next, cards: upsertCard(view.cards, event.card) };
    case 'card-removed':
      return { ...next, cards: view.cards.filter((card) => card.id !== event.cardId) };
    case 'transcript-source':
      return { ...next, transcriptSource: event.source };
    case 'audio-capture':
      return { ...next, audioCapture: event.capture };
    case 'stopped':
      if (view.status.state !== 'listening') return next;
      return {
        ...next,
        status: { ...view.status, state: 'stopped', stoppedAt: event.stoppedAt, reason: event.reason, after: afterStop(event.reason) },
      };
    case 'source-opened':
      return view.opened.includes(event.url) ? next : { ...next, opened: [...view.opened, event.url] };
    case 'page':
      if (view.status.state !== 'listening') return next;
      // Another video: other people, so its voices start again.
      return { ...next, status: { ...view.status, page: event.page }, voices: [] };
    case 'cleared':
      return { ...clearView(view), sessionId: event.sessionId, seq: event.seq };
    case 'line-voice':
      return { ...next, lines: view.lines.map((line) => (line.id === event.lineId ? { ...line, voice: event.voice } : line)) };
    case 'voice': {
      const at = view.voices.findIndex((v) => v.id === event.voice.id);
      return { ...next, voices: at < 0 ? [...view.voices, event.voice] : view.voices.map((v, i) => (i === at ? event.voice : v)) };
    }
    case 'voice-separation':
      return { ...next, voiceSeparation: event.on };
    case 'counters':
      return { ...next, counters: event.counters };
  }
}

/**
 * Clear now: the transcript, cards, opened marks and voices' names are gone; whether it is listening, and
 * on which tab, stays. The panel uses this directly for a session whose
 * offscreen document has already closed.
 */
export function clearView(view: SessionView): SessionView {
  return { ...view, lines: [], cards: [], opened: [], voices: [] };
}

/** Replaces a card in place, or adds it after the other cards from its sentence (else at the end). */
function upsertCard(cards: Card[], card: Card): Card[] {
  const at = cards.findIndex((c) => c.id === card.id);
  if (at >= 0) return cards.map((c, i) => (i === at ? card : c));
  const lastSibling = cards.findLastIndex((c) => c.sentenceId === card.sentenceId);
  if (lastSibling < 0) return [...cards, card];
  return [...cards.slice(0, lastSibling + 1), card, ...cards.slice(lastSibling + 1)];
}

/**
 * What the viewer reads for a voice: the name it was given, else its letter
 * ("Voice A"), following merges. Undefined for no voice, or one forgotten.
 */
export function voiceText(voices: Voice[], id: VoiceId | undefined): string | undefined {
  const seen = new Set<VoiceId>();
  let voice = voices.find((v) => v.id === id);
  while (voice?.sameAs && !seen.has(voice.id)) {
    seen.add(voice.id);
    const next = voices.find((v) => v.id === voice!.sameAs);
    if (!next) break;
    voice = next;
  }
  return voice ? (voice.name ?? voice.label) : undefined;
}

/** Stops after which the icon click's activeTab grant on that tab is gone (or the video moved to a new tab). */
const GRANT_GONE: readonly StopReason[] = ['left-site', 'tab-closed', 'page-unavailable', 'reopened'];
/** Stops the viewer fixes with a key, in Privacy & data. */
const KEY_TROUBLE: readonly StopReason[] = ['key-rejected', 'no-credit', 'no-key', 'search-key-rejected', 'no-search-key'];
/** Stops because the viewer changed the settings: what the new ones still need is shown with the stop message. */
const SETTINGS_CHANGED: readonly StopReason[] = ['mode-changed', 'search-changed', 'key-changed'];

/** What a stop means for the viewer; part of the stopped status. */
function afterStop(reason: StopReason): AfterStop {
  return { canListenAgain: !GRANT_GONE.includes(reason), keyTrouble: KEY_TROUBLE.includes(reason), settingsChanged: SETTINGS_CHANGED.includes(reason) };
}
