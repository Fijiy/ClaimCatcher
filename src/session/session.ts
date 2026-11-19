// The session: the core module of ClaimCatcher, living in the offscreen
// document. It turns one live tab into a stream of events the panel shows.
//
//   inputs  (SessionInput):  start (with settings and page context), caption
//                            segments, on-device transcript segments (with
//                            their voice), how much audio speech-to-text ran
//                            on, voice turns, whether audio is
//                            flowing, how it is captured, forced checks,
//                            answers to "Who said this?" and "Who is this?",
//                            "Tell voices apart", stop, a source the viewer
//                            opened, a new page, Clear now
//   outputs (SessionEvent):  started, transcript lines (and their voices),
//                            skipped parts, cards (which carry their "Who said
//                            this?" and "Who is this?" prompts), the
//                            transcript's source, how audio is captured (a
//                            blocked player), voices, voice separation on or
//                            off, footer counters, stopped, opened sources, page,
//                            cleared
//   deps    (SessionDeps):   injected platform pieces (clock, fetch, the
//                            on-device claim filter, Chrome's LanguageModel
//                            for local mode, source-ratings data)
//
// Captions are preferred; the on-device transcript fills in while they're
// missing (./transcript-source). Each transcript sentence goes through the claim filter, then the check
// pipeline in ./checks (breakdown -> search -> evidence -> verdict ->
// consistency rule). A forced check skips the filter.
//
// It is the main test seam: tests drive `dispatch` and assert on what
// `subscribe` receives. Nothing in here touches `chrome.*`.

import { FILTERED, passesFilter } from './checks/filter';
import { createNanoModel, NANO_OPTIONS } from './checks/nano';
import type { Usage } from './checks/provider';
import { checkSentence, type CheckDeps, type CheckReport } from './checks/pipeline';
import { CONTEXT_SECONDS, createSentenceAssembler, type Sentence, type SentenceAssembler } from './checks/sentences';
import { mergeNames, namesOnPage, pageSpeaker } from './checks/speaker';
import { createVenice } from './checks/venice';
import { addCounts, usageCounts } from './counters';
import { KEYS, keyFor, SEARCHES, searchFor } from './searches';
import { bundledRatings } from './sources/bundled';
import { createTranscriptSwitch } from './transcript-source';
import { createRepeatGuard } from './repeats';
import { createVoiceBook } from './voice-book';
import { applyEvent, emptyView } from './view';
import type {
  AudioCapture,
  AudioSource,
  Card,
  JudgedAsOf,
  PageContext,
  SessionChange,
  SessionCounters,
  SessionDeps,
  SessionEvent,
  SessionInput,
  SearchId,
  SessionSettings,
  SessionView,
  SkippedPart,
  Speaker,
  StopReason,
  TranscriptLine,
  TranscriptSource,
  VoiceId,
  VoiceTurn,
} from './types';

export interface Session {
  dispatch(input: SessionInput): void;
  /** Calls `listener` with every event from now on. Returns an unsubscribe. */
  subscribe(listener: (event: SessionEvent) => void): () => void;
  /** Everything seen so far: the fold of every event emitted. */
  snapshot(): SessionView;
  /**
   * Resolves once no check is in flight. After Stop, the checks already
   * running still reach a label (as `card` events); this says when they have.
   */
  settled(): Promise<void>;
}

export function createSession(deps: SessionDeps): Session {
  const { clock } = deps;
  const sessionId = (deps.newId ?? (() => crypto.randomUUID()))();
  const listeners = new Set<(event: SessionEvent) => void>();
  let view: SessionView = { ...emptyView, sessionId };
  let lineCount = 0;
  const seenCues = new Set<string>();
  let sentences: SentenceAssembler | undefined;
  const inFlight = new Set<Promise<void>>();
  const forcedLines = new Set<string>();
  /** Cards that have reached a label (counted as claims), in this Clear now generation. */
  const labelled = new Set<string>();
  /** Sentences already sent to the checks, to spot the same words heard again. */
  const heardBefore = createRepeatGuard();
  const transcript = createTranscriptSwitch(clock, {
    switched: (source) => {
      emit({ type: 'transcript-source', source });
      updateSeparation();
    },
    show: (segment) => addLine(segment.start, segment.text, 'on-device', segment.voice),
  });
  /** The voices told apart on this page. */
  const voices = createVoiceBook(clock, (voice) => emit({ type: 'voice', voice }));
  /** The viewer chose "Tell voices apart for this video". */
  let separateAsked = false;
  /** Cards asking "Who said this?", and how to check each again once answered. */
  const awaitingSpeaker = new Map<string, (speaker: Speaker) => Promise<void>>();
  /** Names the viewer has given this session, offered on later prompts too. */
  const namedByViewer: string[] = [];
  /** The settings this session started with are no longer agreed to: no more re-checks. */
  let withdrawn = false;

  function emit(change: SessionChange) {
    const event = { ...change, sessionId, seq: view.seq + 1 } as SessionEvent;
    view = applyEvent(view, event);
    for (const listener of listeners) listener(event);
  }

  /**
   * Adds to the footer's counters (SessionCounters) and tells the panel. One
   * call per thing used, e.g. `count({ voiceSeparationMinutes: seconds / 60 })`.
   */
  function count(delta: Partial<SessionCounters>) {
    if (view.status.state === 'idle') return;
    emit({ type: 'counters', counters: addCounts(view.counters, delta) });
  }

  function setAudioCapture(capture: AudioCapture) {
    if (JSON.stringify(capture) === JSON.stringify(view.audioCapture)) return;
    emit({ type: 'audio-capture', capture });
  }

  /** Whether audio from `from` is heard: once tabCapture runs, it hears the whole tab and the page's source has no say. */
  const heard = (from: AudioSource = 'page') => from === 'tab' || view.audioCapture.via !== 'tab';

  function stop(reason: StopReason) {
    if (view.status.state !== 'listening') return;
    sentences?.close();
    transcript.close();
    emit({ type: 'stopped', reason, stoppedAt: clock.now() });
    refreshCards((card) => !!card.whoSaid?.offerVoices);
  }

  /** This session's checks. `generation` goes up with each Clear now. */
  let checks: { deps: CheckDeps; generation: number } | undefined;

  function startChecks(page: PageContext, settings: SessionSettings) {
    // Every answered call counts, whichever check (or Clear now generation) it was for: it was used.
    const onUsage = (usage: Usage) => count(usageCounts(usage));
    // The provider's adapter holds a key only when it is the provider's.
    const provider = createVenice(deps.fetch, keyFor(settings.mode, settings.search) === 'venice' ? settings.key : '', undefined, { onUsage });
    // Local mode judges on the device and searches at the viewer's chosen search; cloud mode uses the provider for both.
    const local = settings.mode === 'local';
    const model = local && deps.languageModel ? createNanoModel(deps.languageModel, { clock, onUsage }) : provider.model;
    const search = SEARCHES[searchOf(settings)].create({ fetch: deps.fetch, key: settings.key, onUsage, providerSearch: provider.search });
    const checkDeps: CheckDeps = {
      model,
      search,
      page,
      ratings: deps.ratings ?? bundledRatings,
      // The page may change (same-site navigation), so read it at check time.
      judgedAsOf: () => judgedAsOf(checkDeps.page, clock.now()),
      speakerNames: () => mergeNames([...namesOnPage(checkDeps.page), ...namedByViewer]),
    };
    checks = {
      deps: checkDeps,
      generation: 0,
    };
    sentences = newSentences();
  }

  /** A fresh sentence assembler: it holds no earlier transcript as context. */
  function newSentences(): SentenceAssembler {
    return createSentenceAssembler(clock, (sentence) => runCheck(sentence, false));
  }

  /**
   * Runs one sentence through the checks (past the claim filter if forced),
   * and keeps track of it until it settles. Reports from a check started
   * before a Clear now are dropped, so a cleared card can't come back; a
   * refused key still stops listening.
   */
  function runCheck(sentence: Sentence, forced: boolean) {
    const current = checks;
    if (!current) return;
    const generation = current.generation;
    const live =
      <A extends unknown[]>(report: (...args: A) => void) =>
      (...args: A) => {
        if (current.generation === generation) report(...args);
      };
    let askedVoice = false;
    const report = {
      card: live((card: Card) => {
        if (card.whoIsThis) askedVoice = true;
        // A claim counts once, when it first reaches a label.
        if (card.check.state === 'done' && !labelled.has(card.id)) {
          labelled.add(card.id);
          count({ claims: 1 });
        }
        emitCard(card);
      }),
      removeCard: live((cardId: string) => emit({ type: 'card-removed', cardId })),
      skipped: live((lineId: string, parts: SkippedPart[]) => emit({ type: 'line-skipped', lineId, parts })),
      fatal: (kind: StopReason) => stop(kind),
      awaitSpeaker: live((cardId: string, recheck: (speaker: Speaker) => Promise<void>) => {
        awaitingSpeaker.set(cardId, recheck);
        // The voice may have been answered while this claim was being pulled out.
        const card = view.cards.find((c) => c.id === cardId);
        if (card?.voice) settleWaiting(card.voice);
      }),
    } satisfies CheckReport;
    // The same words heard again (a replay, a seek back, captions and the on-device transcript both): checked once.
    if (!forced && heardBefore.seen(sentence)) return;
    track(async () => {
      if (!forced && !(await passesFilter(deps.claimFilter, sentence.text))) {
        report.skipped(sentence.lineId, [{ text: sentence.text, reason: FILTERED }]);
        return;
      }
      const voice = await voiceOf(sentence);
      if (current.generation !== generation) return;
      const asking = voice.askVoice !== undefined;
      try {
        await checkSentence(sentence, current.deps, report, { forced, ...voice });
      } finally {
        // No claim after all: the voice's first claim is still to come, and
        // claims waiting on a prompt that never showed ask "Who said this?".
        if (asking && !askedVoice && voice.voice) {
          voices.setAsking(voice.voice, false);
          settleWaiting(voice.voice);
        }
      }
    });
  }

  // ---- Voices -----------------------------------------------------------------

  /** Voices are told apart while the transcript is on-device, or once the viewer asks on this video. */
  const separating = () => deps.separatesVoices === true && (separateAsked || view.transcriptSource === 'on-device');

  function updateSeparation() {
    const on = separating();
    if (on === view.voiceSeparation || view.status.state !== 'listening') return;
    emit({ type: 'voice-separation', on });
    // "Tell voices apart for this video" is offered only while it's off.
    refreshCards((card) => !!card.whoSaid);
  }

  /**
   * Who said a sentence, as the check needs it: the named voice's speaker, or
   * the voice to ask about (its first claim), or just the voice. A caption's
   * voice is known once its audio has been separated, so this waits for that.
   */
  async function voiceOf(sentence: Sentence): Promise<{ voice?: VoiceId; speaker?: Speaker; askVoice?: string[]; awaitsVoice?: boolean }> {
    if (!separating()) return {};
    const line = view.lines.find((l) => l.id === sentence.lineId);
    if (!line) return {};
    if (!line.voice && !voices.covered(line.time)) await voices.waitFor(line.time);
    const id = view.lines.find((l) => l.id === sentence.lineId)?.voice;
    const voice = id ? voices.get(id) : undefined;
    if (!id || !voice) return {};
    if (voice.name) return { voice: id, speaker: { name: voice.name, from: 'voice' } };
    if (voice.skipped) return { voice: id };
    // The page names one person: they are the speaker (speaker gate), so a new voice isn't asked about.
    if (checks && pageSpeaker(checks.deps.page, checks.deps.model.onDevice === true)) return { voice: id };
    if (voices.asking(id)) return { voice: id, awaitsVoice: true };
    voices.setAsking(id, true);
    return { voice: id, askVoice: checks?.deps.speakerNames() ?? [] };
  }

  /** A card as the viewer sees it now: its voice's name, and only the prompts still open. */
  function decorate(card: Card): Card {
    const voice = card.voice ? voices.get(card.voice) : undefined;
    let shown = card;
    if (voice?.name && !shown.speaker) shown = { ...shown, speaker: { name: voice.name, from: 'voice' } };
    if (withdrawn) {
      const { whoSaid: _said, whoIsThis: _voice, ...rest } = shown;
      return rest;
    }
    if (shown.whoIsThis && (!voice || voice.name || voice.skipped)) {
      const { whoIsThis: _done, ...rest } = shown;
      shown = rest;
    }
    if (shown.whoSaid) {
      const { offerVoices: _offer, ...prompt } = shown.whoSaid;
      // "Tell voices apart" only while there is audio to tell apart.
      const offer = deps.separatesVoices === true && !separating() && view.status.state === 'listening';
      shown = { ...shown, whoSaid: offer ? { ...prompt, offerVoices: true } : prompt };
    }
    return shown;
  }

  function emitCard(card: Card) {
    emit({ type: 'card', card: decorate(card) });
  }

  /** Shows the cards matching `which` again, as they look now. */
  function refreshCards(which: (card: Card) => boolean) {
    for (const card of view.cards.filter(which)) {
      const shown = decorate(card);
      if (JSON.stringify(shown) !== JSON.stringify(card)) emit({ type: 'card', card: shown });
    }
  }

  const ofVoice = (voice: VoiceId) => (card: Card) => !!card.voice && voices.same(card.voice, voice);

  /** "Who is this?" answered: the voice's claims waiting for a speaker are checked again with that name. */
  function nameVoice(voiceId: VoiceId, raw: string) {
    const voice = voices.get(voiceId);
    const name = raw.replace(/\s+/g, ' ').trim();
    if (withdrawn || !voice || voice.name || !name) return;
    voices.name(voice.id, name);
    voices.setAsking(voice.id, false);
    const named = voices.get(voice.id)!.name!;
    if (!namedByViewer.includes(named)) namedByViewer.push(named);
    const rechecked = new Set(view.cards.filter((card) => ofVoice(voice.id)(card) && awaitingSpeaker.has(card.id)).map((card) => card.id));
    settleWaiting(voice.id);
    refreshCards((card) => ofVoice(voice.id)(card) && !rechecked.has(card.id));
  }

  /** Skip on "Who is this?": the voice stays unnamed, and its waiting claims ask "Who said this?". */
  function skipVoice(voiceId: VoiceId) {
    const voice = voices.get(voiceId);
    if (!voice || voice.name || voice.skipped) return;
    voices.skip(voice.id);
    voices.setAsking(voice.id, false);
    settleWaiting(voice.id);
    refreshCards(ofVoice(voice.id));
  }

  /**
   * Claims of a voice waiting for its speaker, once "Who is this?" is no
   * longer open for it: named, they are checked again with the name;
   * otherwise each asks "Who said this?".
   */
  function settleWaiting(voiceId: VoiceId) {
    const voice = voices.get(voiceId);
    if (!voice || (!voice.name && voices.asking(voice.id))) return;
    if (voice.name) {
      const speaker: Speaker = { name: voice.name, from: 'voice' };
      for (const card of view.cards.filter(ofVoice(voice.id))) {
        const recheck = awaitingSpeaker.get(card.id);
        if (!recheck) continue;
        awaitingSpeaker.delete(card.id);
        track(() => recheck(speaker));
      }
      return;
    }
    for (const card of view.cards.filter(ofVoice(voice.id))) {
      if (awaitingSpeaker.has(card.id) && !card.whoSaid) emitCard({ ...card, whoSaid: { names: checks?.deps.speakerNames() ?? [] } });
    }
  }

  /** Voice separation's result for a stretch of audio: caption lines spoken there get their voice. */
  function recordVoices(span: { start: number; end: number }, turns: VoiceTurn[], merged: Array<{ voice: VoiceId; into: VoiceId }>, failed: boolean) {
    voices.record(span, failed ? [] : turns, merged);
    for (const line of view.lines.slice(-200)) {
      if (line.voice || line.time < span.start - 0.5 || line.time > span.end) continue;
      const voice = voices.at(line.time);
      if (voice) emit({ type: 'line-voice', lineId: line.id, voice });
    }
    if (merged.length > 0) refreshCards((card) => !!card.voice);
    if (!failed) {
      count({ voiceSeparationMinutes: Math.max(0, span.end - span.start) / 60 });
    }
  }

  /** Runs a check and keeps track of it until it settles. */
  function track(run: () => Promise<void>) {
    const check = run().catch((error: unknown) => console.error('[ClaimCatcher] check failed', error));
    inFlight.add(check);
    void check.finally(() => inFlight.delete(check));
  }

  function addLine(time: number, text: string, source: TranscriptSource, voiceTag?: VoiceId) {
    const voice = voiceTag ? voices.tag(voiceTag) : voices.at(time);
    const line: TranscriptLine = {
      id: `${sessionId}:${++lineCount}`,
      time,
      text,
      source,
      heardAt: clock.now(),
      ...(voice ? { voice } : {}),
    };
    emit({ type: 'line', line });
    sentences?.add(line);
  }

  /**
   * The viewer named who said a card's claim: that card, and any other card
   * from the same sentence still asking, is checked again with that speaker.
   */
  function answerSpeaker(cardId: string, name: string) {
    const sentenceId = view.cards.find((c) => c.id === cardId)?.sentenceId;
    const speaker: Speaker = { name: name.replace(/\s+/g, ' ').trim(), from: 'viewer' };
    if (withdrawn || !sentenceId || !speaker.name || !awaitingSpeaker.has(cardId)) return;
    if (!namedByViewer.includes(speaker.name)) namedByViewer.push(speaker.name);
    for (const card of view.cards.filter((c) => c.sentenceId === sentenceId)) {
      const recheck = awaitingSpeaker.get(card.id);
      if (!recheck) continue;
      awaitingSpeaker.delete(card.id);
      track(() => recheck(speaker));
    }
  }

  /**
   * "Check this" on a line: its skipped words (or, with none, the whole line)
   * go through the checks from claim breakdown on, past the filter.
   */
  function forceCheck(lineId: string) {
    const at = view.lines.findIndex((l) => l.id === lineId);
    const line = view.lines[at];
    if (!line || !checks || forcedLines.has(lineId)) return;
    forcedLines.add(lineId);
    // A claim the review dropped is a rewrite, not the line's words: then the whole line is checked.
    const parts = line.skipped ?? [];
    const text = parts.length > 0 && !parts.some((part) => part.claim) ? parts.map((part) => part.text).join(' ') : line.text;
    const context = view.lines
      .slice(0, at)
      .filter((l) => l.time >= line.time - CONTEXT_SECONDS)
      .map((l) => l.text)
      .join(' ');
    runCheck({ id: `f${forcedLines.size}`, text, lineId, time: line.time, context }, true);
  }

  function clear() {
    if (view.status.state === 'idle') return;
    seenCues.clear();
    forcedLines.clear();
    labelled.clear();
    heardBefore.clear();
    awaitingSpeaker.clear();
    voices.reset();
    if (checks) checks.generation++;
    if (view.status.state === 'listening' && checks) {
      sentences?.close();
      sentences = newSentences();
    }
    emit({ type: 'cleared' });
  }

  function dispatch(input: SessionInput) {
    const status = view.status;
    switch (input.type) {
      case 'start': {
        if (status.state !== 'idle') return;
        emit({ type: 'started', tabId: input.tabId, page: input.page, startedAt: clock.now() });
        // Never call a service without its key (Venice answers that with a 402).
        // Local mode needs the provider's key only to search there.
        if (!input.settings.key.trim()) return stop(KEYS[keyFor(input.settings.mode, input.settings.search)].missing);
        if (input.settings.mode === 'local') {
          // Never a quiet switch to cloud mode: without Nano, local mode stops.
          const nano = deps.languageModel;
          if (!nano) return stop('local-model-unavailable');
          nano.availability(NANO_OPTIONS).then(
            (availability) => availability !== 'available' && stop('local-model-unavailable'),
            () => stop('local-model-unavailable'),
          );
        }
        startChecks(input.page, { ...input.settings, key: input.settings.key.trim() });
        return;
      }
      case 'caption': {
        if (status.state !== 'listening' || input.tabId !== status.tabId) return;
        const text = input.segment.text.trim();
        if (!text) return;
        const cueKey = `${input.segment.reader}|${input.segment.start}|${text}`;
        if (seenCues.has(cueKey)) return;
        seenCues.add(cueKey);
        transcript.caption(input.segment);
        addLine(input.segment.start, text, 'captions');
        return;
      }
      case 'on-device-segment': {
        if (status.state !== 'listening' || input.tabId !== status.tabId || !heard(input.from)) return;
        const text = input.segment.text.trim();
        if (text) transcript.onDevice({ ...input.segment, text });
        return;
      }
      case 'speech-to-text':
        if (status.state !== 'listening' || input.tabId !== status.tabId || !heard(input.from) || !(input.seconds > 0)) return;
        count({ speechToTextMinutes: input.seconds / 60 });
        return;
      case 'audio':
        if (status.state !== 'listening' || input.tabId !== status.tabId || !heard(input.from)) return;
        // A page player heard after all (another one started playing): it no longer blocks.
        if (input.flowing && (input.from ?? 'page') === 'page' && view.audioCapture.via === 'blocked') setAudioCapture({ via: 'page' });
        transcript.audio(input.flowing);
        return;
      case 'audio-capture':
        if (status.state !== 'listening' || input.tabId !== status.tabId) return;
        // tabCapture, once running, hears the tab whatever its players do.
        if (input.capture.via === 'blocked' && view.audioCapture.via === 'tab') return;
        setAudioCapture(input.capture);
        return;
      case 'force-check':
        if (status.state !== 'listening') return;
        forceCheck(input.lineId);
        return;
      case 'speaker-answer':
        // After Stop too: the card stays answerable, and the answer re-checks
        // it (nothing new is heard).
        if (status.state === 'idle') return;
        answerSpeaker(input.cardId, input.name);
        return;
      case 'stop':
        stop(input.reason);
        return;
      case 'source-opened':
        if (view.opened.includes(input.url) || !shownOnACard(view, input.url)) return;
        emit({ type: 'source-opened', url: input.url });
        return;
      case 'page':
        if (status.state !== 'listening' || input.tabId !== status.tabId) return;
        // A new video's cues start again at 0:00, so last page's can't hide them.
        seenCues.clear();
        heardBefore.clear();
        transcript.newMedia();
        if (checks) checks.deps.page = input.page;
        // Other people: the voices start again, and so does the viewer's choice for the video.
        voices.reset();
        separateAsked = false;
        emit({ type: 'page', page: input.page });
        // The old page's player is gone with it. tabCapture follows the tab, so it carries on.
        if (view.audioCapture.via === 'blocked') setAudioCapture({ via: 'page' });
        updateSeparation();
        return;
      case 'clear':
        clear();
        return;
      case 'voices':
        if (status.state !== 'listening' || input.tabId !== status.tabId || !heard(input.from)) return;
        recordVoices(input.span, input.turns, input.merged ?? [], input.failed === true);
        return;
      // After Stop too, like "Who said this?": the voice's waiting claims are re-checked.
      case 'voice-name':
        if (status.state === 'idle') return;
        nameVoice(input.voice, input.name);
        return;
      case 'voice-skip':
        if (status.state === 'idle') return;
        skipVoice(input.voice);
        return;
      case 'separate-voices':
        if (status.state !== 'listening') return;
        separateAsked = true;
        updateSeparation();
        return;
      case 'settings-withdrawn':
        if (status.state !== 'stopped' || withdrawn) return;
        withdrawn = true;
        awaitingSpeaker.clear();
        refreshCards((card) => !!card.whoSaid || !!card.whoIsThis);
        return;
    }
  }

  return {
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => view,
    async settled() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}

/** Whether some card shows this link, as evidence or as context. */
function shownOnACard(view: SessionView, url: string): boolean {
  return view.cards.some(
    (card) => card.check.state === 'done' && [...card.check.verdict.sources, ...(card.check.verdict.context ?? [])].some((s) => s.url === url),
  );
}

/**
 * The judged-as-of date (GLOSSARY): when the claim was said if the page gives
 * the recording date, otherwise the day of the check. A date that doesn't
 * parse, or is later than today, is ignored.
 */
function judgedAsOf(page: PageContext, now: number): JudgedAsOf {
  const today = localDate(now);
  const recorded = page.recordedOn?.trim();
  // YYYY-MM-DD compares correctly as a string.
  if (recorded && /^\d{4}-\d{2}-\d{2}$/.test(recorded) && recorded <= today) {
    // A date the title gives within a day of it wins: YouTube dates a live stream by its UTC start.
    const titled = dateIn(page.title);
    const near = titled && Math.abs(Date.parse(titled) - Date.parse(recorded)) <= 86_400_000;
    return { date: near && titled <= today ? titled : recorded, basis: 'recording' };
  }
  return { date: today, basis: 'check' };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A date written out in text ("March 4, 2025", "Mar. 4, 2025", "4 March 2025"), as YYYY-MM-DD. */
function dateIn(text: string): string | null {
  const month = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  const mdy = new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i').exec(text);
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${month}\\s+(\\d{4})\\b`, 'i').exec(text);
  const [name, day, year] = mdy ? [mdy[1]!, mdy[2]!, mdy[3]!] : dmy ? [dmy[2]!, dmy[1]!, dmy[3]!] : [];
  if (!name || !day || !year) return null;
  const mm = MONTHS.findIndex((n) => n.startsWith(name.toLowerCase())) + 1;
  const dd = Number(day);
  if (mm < 1 || dd < 1 || dd > 31) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** The viewer's local calendar date, YYYY-MM-DD. */
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where a session's claims are searched: cloud mode always at the provider; local mode at the viewer's choice. */
export function searchOf(settings: SessionSettings): SearchId {
  return searchFor(settings.mode, settings.search);
}
