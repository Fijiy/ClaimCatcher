// The session's public vocabulary: what goes in, what comes out, and what it
// depends on. Everything here is plain data so it can cross runtime messages.
// Terms follow GLOSSARY.md.

import type { LanguageModelFactory } from './checks/nano';
import type { RatingsSnapshot } from './sources/ratings';

/** Which caption reader produced a segment (the spec allows exactly three). */
export type CaptionReaderId = 'track' | 'youtube' | 'house';

/**
 * One caption cue as a reader saw it. Times are seconds of media time (the
 * video's `currentTime`), not wall-clock time.
 */
export interface CaptionSegment {
  reader: CaptionReaderId;
  /** Media time the cue starts, in seconds. */
  start: number;
  /** Media time the cue ends, in seconds. */
  end: number;
  text: string;
}

/**
 * A stretch of the on-device transcript: speech-to-text run on the tab's own
 * audio, on the device. Times are seconds of media time, as for captions.
 */
export interface OnDeviceSegment {
  start: number;
  end: number;
  text: string;
  /** The voice that said most of it, when voice separation was on (GLOSSARY: voice). */
  voice?: VoiceId;
}

/**
 * A voice told apart in the tab's audio by voice separation, on the device
 * (GLOSSARY: voice). The worker's ids are opaque and never reused; the panel
 * shows "Voice A", "Voice B"… or the name the viewer gave it.
 */
export type VoiceId = string;

/** A stretch of the tab's audio in which one voice spoke, in seconds of media time. */
export interface VoiceTurn {
  start: number;
  end: number;
  voice: VoiceId;
}

/** A voice as the viewer knows it. */
export interface Voice {
  id: VoiceId;
  /** "Voice A", "Voice B"… in the order the voices were first heard this session. */
  label: string;
  /** The name the viewer gave it ("Who is this?"): the speaker of its claims. */
  name?: string;
  /** The viewer chose Skip on "Who is this?": its claims ask "Who said this?" as without voices. */
  skipped?: true;
  /** Merged into this voice (the same name given twice, or voice separation found them the same). */
  sameAs?: VoiceId;
}

/**
 * What the page says about itself, read under the icon click's activeTab grant
 * when listening starts. The names on the page (the "Who said this?" buttons)
 * are found in the title, channel and description by the session itself.
 */
export interface PageContext {
  title: string;
  /** The page's address. Never sent anywhere. */
  url: string;
  /** The channel or uploader shown on the page, when the page says. */
  channel?: string;
  /**
   * The video's description, when the page gives one. It stays on the device:
   * in cloud mode only the title and channel go to the provider.
   */
  description?: string;
  /**
   * When the video was recorded, YYYY-MM-DD, if the page says (YouTube does).
   * Claims are judged as of this date; without it, as of the day of the check.
   */
  recordedOn?: string;
}

/**
 * Where claims are judged (GLOSSARY): on this device by Chrome's Gemini Nano
 * (local mode), or by the provider's model (cloud mode). Cloud mode searches
 * at the provider; local mode at the search the viewer chose (`SearchId`).
 */
export type Mode = 'local' | 'cloud';

/**
 * Where the claims' search queries go (GLOSSARY: search). Cloud mode always
 * searches at the provider (Venice). Local mode searches at the one the
 * viewer chose: TinyFish (a free key, the default) or Venice (the provider's
 * key). Never more than one, and never a quiet switch to another.
 */
export type SearchId = 'venice' | 'tinyfish';

/** The keys the viewer can set: the provider's (Venice), and TinyFish's (local mode's free search). See searches.ts. */
export type KeyId = 'venice' | 'tinyfish';

/** The viewer's settings a session needs, handed over when it starts. */
export interface SessionSettings {
  mode: Mode;
  /** Local mode's search. Cloud mode always searches at the provider. Defaults to the provider's. */
  search?: SearchId;
  /**
   * The one key the mode and search need (`keyFor` in searches.ts): the
   * provider's (Venice) in cloud mode or when local mode searches there,
   * TinyFish's when it searches at TinyFish. A session holds no other key, so
   * each key goes only to its own service.
   */
  key: string;
}

/**
 * How the tab's audio is captured (spec "Capture"). First the page's own media
 * element, through `captureStream()`. A player that blocks that falls back to
 * Chrome's tabCapture, once the viewer has allowed it.
 */
export type AudioCapture =
  /** The page's media element (or nothing playing yet). */
  | { via: 'page' }
  /** tabCapture: the whole tab's audio, for a player that blocks direct listening. */
  | { via: 'tab' }
  /** "This player blocks direct listening", and tabCapture can't be used on this page (yet). */
  | { via: 'blocked'; why: BlockedPlayer };

/**
 * Which audio source an input about the tab's audio came from: the page's
 * media element (the default) or tabCapture. While tabCapture runs it hears
 * the whole tab, so the session ignores what the page's source still sends.
 */
export type AudioSource = 'page' | 'tab';

/**
 * Why the page's player can't be listened to directly: its media comes from
 * another origin without CORS, it is DRM-protected, or it is a video embedded
 * from another site (in a frame ClaimCatcher has no access to).
 */
export type BlockedPlayer = 'cross-origin' | 'drm' | 'embed' | 'other';

/** Where a transcript line's words came from, as shown on the line. */
export type TranscriptSource = 'captions' | 'on-device';

/** One timed line of the transcript, as the viewer sees it. */
export interface TranscriptLine {
  id: string;
  /** When the words were spoken, in seconds of media time. Replay seeks here. */
  time: number;
  text: string;
  source: TranscriptSource;
  /** Wall-clock time (ms since epoch) the session received the line. */
  heardAt: number;
  /** Parts of the line that hold no checkable claim, with why (from claim breakdown). */
  skipped?: SkippedPart[];
  /** Who spoke it, when voice separation told the voices apart. */
  voice?: VoiceId;
}

/** Why a statement was skipped (GLOSSARY: skipped statement). */
export type SkipReason =
  | 'opinion'
  | 'value judgement'
  | 'hyperbole'
  | 'rhetorical question'
  | 'prediction'
  | 'promise'
  | 'no checkable fact'
  /** The generic reason: the on-device claim filter dropped the sentence before any LLM saw it. */
  | 'not flagged as a claim'
  /** The claim review: who or what the claim is about can't be told from what was said (`SkippedPart.unclear`). */
  | 'not self-contained'
  /** The claim review: no specific fact a source could settle. */
  | 'too vague to check'
  /** The claim review: trivially true, so no one could be misled by it. */
  | 'not worth checking';

export interface SkippedPart {
  text: string;
  reason: SkipReason;
  /** Not self-contained: the words whose referent no one named ("they"). */
  unclear?: string;
  /**
   * A claim the claim review dropped: `text` is the claim as breakdown wrote
   * it (stand-alone), not words of the line, so "Check this" checks the whole line.
   */
  claim?: true;
}

// ---- Cards ------------------------------------------------------------------

/** The four labels (GLOSSARY: Verdicts). */
export type Label = 'True' | 'Misleading' | 'False' | 'Unverified';

/** Where a card's check is: pulling out the claim -> searching -> weighing sources. */
export type CheckStage = 'breakdown' | 'search' | 'weighing';

/** A claim as claim breakdown wrote it. */
export interface Claim {
  /** What the words assert, references resolved. Shown in bold on the card. */
  literal: string;
  /** What the listener is meant to conclude (GLOSSARY: implied claim). */
  implied: string;
  /** The quoted skipped line this claim is the premise of, if it is one. */
  premiseOf: string | null;
  /** What kind of skipped statement that line is (a prediction, a promise…), when breakdown said. */
  premiseKind?: SkipReason;
}

/** Whether a source backs the claim, according to the verdict step. */
export type Stance = 'supports' | 'contradicts' | 'neither';

/** MBFC's left-to-right placement of an outlet (GLOSSARY: bias rating). */
export type Bias = 'L' | 'LC' | 'C' | 'RC' | 'R';

/**
 * MBFC's factual reporting for an outlet that is shown (GLOSSARY: reliability
 * rating); null when MBFC gives none. Low ratings are never shown.
 */
export type Reliability = 'very high' | 'high' | 'mostly factual' | 'mixed' | null;

/** How a source is rated, which decides its pill. */
export type SourceRating =
  /** On the bundled primary-source list (GLOSSARY: primary source): a "Primary" pill. */
  | { kind: 'primary' }
  /** Rated by MBFC: a bias pill linking to its MBFC page. Pro-science outlets have no place on the spectrum. */
  | { kind: 'mbfc'; bias: Bias | 'pro-science'; reliability: Reliability; name: string; page: string | null }
  /** Neither. */
  | { kind: 'unrated' };

/**
 * How much a source counts. Full: primary sources and MBFC VERY HIGH / HIGH.
 * Reduced: everything else that is shown (MIXED, or no reliability rating).
 * The bias rating never changes it.
 */
export type Weight = 'full' | 'reduced';

/** A search result as the card shows it. */
export interface ShownSource {
  title: string;
  url: string;
  /** The link's domain, without `www.`. */
  domain: string;
  /** The trimmed snippet. */
  snippet: string;
  /** The result's date if the search gave one (a hint only). */
  published: string | null;
  rating: SourceRating;
}

/** One piece of evidence the verdict was weighed on. */
export interface CardSource extends ShownSource {
  /** Its number in the verdict prompt, from 1. */
  n: number;
  weight: Weight;
  stance: Stance;
  /**
   * The professional fact-checker that published it ("PolitiFact"), when one
   * did: highlighted on the card. It is weighted like any other source, and
   * the verdict is still ClaimCatcher's own.
   */
  factCheck?: string;
}

/**
 * A partisan source (GLOSSARY): a campaign, party or political-office site.
 * Shown on the card as context only; the verdict step never sees it.
 */
export type ContextSource = ShownSource;

export interface Verdict {
  label: Label;
  /** The one-line, plain-words conclusion. */
  conclusion: string;
  /** What's missing, for Misleading; otherwise null. */
  missing: string | null;
  /** The evidence, full-weight sources first. */
  sources: CardSource[];
  /** Partisan sources found by the search, shown for context only; absent when there are none. */
  context?: ContextSource[];
  /** The judged-as-of date, YYYY-MM-DD. */
  judgedAsOf: string;
  /** Where that date came from: the page's recording date, or the day of the check. */
  judgedAsOfBasis: JudgedAsOfBasis;
}

export type JudgedAsOfBasis = 'recording' | 'check';

/** A judged-as-of date (GLOSSARY) and where it came from. */
export interface JudgedAsOf {
  /** YYYY-MM-DD. */
  date: string;
  basis: JudgedAsOfBasis;
}

export interface Card {
  id: string;
  /** Cards from one sentence share this and sit together, in claim order. */
  sentenceId: string;
  /** The transcript line the sentence starts on. */
  lineId: string;
  /** When the sentence was said, in seconds of media time. */
  time: number;
  /** The sentence the claim came from. */
  sentence: string;
  /** Null while the claim is still being pulled out. */
  claim: Claim | null;
  /** The viewer asked for this check (GLOSSARY: forced check); the card says "You asked to check this". */
  forced?: boolean;
  /** Who said the claim, when known (GLOSSARY: speaker). The card shows it. */
  speaker?: Speaker;
  /**
   * The claim depends on who said it and nothing settles that: the card asks
   * "Who said this?" and stays Unverified until the viewer answers.
   */
  whoSaid?: SpeakerPrompt;
  /** The voice that said it, when voice separation is on. */
  voice?: VoiceId;
  /** This voice's first claim: the card asks "Who is this?" (once per voice). */
  whoIsThis?: VoicePrompt;
  check: { state: 'checking'; stage: CheckStage } | { state: 'done'; verdict: Verdict };
}

/**
 * The person who said a claim (GLOSSARY: speaker): named by the page, by
 * the viewer answering "Who said this?", or through the voice the viewer
 * named ("Who is this?"). Never inferred from what was said.
 */
export interface Speaker {
  name: string;
  from: SpeakerSource;
}

/** Named by the page, by the viewer answering "Who said this?", or through the voice the viewer named. */
export type SpeakerSource = 'page' | 'viewer' | 'voice';

/** "Who said this?" on a card. */
export interface SpeakerPrompt {
  /** The names found on the page (and any the viewer has given this session), as one-tap answers. */
  names: string[];
  /** Voice separation is off (a captioned page): the prompt offers "Tell voices apart for this video". */
  offerVoices?: true;
}

/** "Who is this?" on a new voice's first claim: [Name 1] [Name 2] … [Skip]. */
export interface VoicePrompt {
  voice: VoiceId;
  /** As for "Who said this?": the names on the page and any the viewer has given. */
  names: string[];
}

/** Why listening ended; the panel will say so in words (later ticket). */
export type StopReason =
  | 'viewer'
  | 'tab-closed'
  /** The tab moved to another site, which ClaimCatcher wasn't started on. */
  | 'left-site'
  | 'page-unavailable'
  /** The start had no API key, so listening never began. */
  | 'no-key'
  /** The provider rejected the key (401). */
  | 'key-rejected'
  /** The key has no credit left or hit its spending limit (402). */
  | 'no-credit'
  /** Local mode searches at TinyFish, and there is no TinyFish key (none set, or it was forgotten). */
  | 'no-search-key'
  /** TinyFish rejected the search key (401). */
  | 'search-key-rejected'
  /** The viewer chose another search (and agreed to it); the next session uses it. */
  | 'search-changed'
  /** Local mode, but Gemini Nano can't run here or hasn't finished downloading. Never a switch to cloud mode. */
  | 'local-model-unavailable'
  /** The viewer switched mode (and agreed to the new one); the next session uses it. */
  | 'mode-changed'
  /** The viewer saved a different key for the one the session was using; the next session uses the new key. */
  | 'key-changed'
  /** A blocked player's page was opened again in a new tab, where tabCapture works once the icon is clicked there. */
  | 'reopened';

export type SessionStatus =
  | { state: 'idle' }
  | { state: 'listening'; tabId: number; page: PageContext; startedAt: number }
  | { state: 'stopped'; tabId: number; page: PageContext; startedAt: number; stoppedAt: number; reason: StopReason; after: AfterStop };

/** What a stop means for the viewer (`afterStop` in view.ts). The panel only displays it. */
export interface AfterStop {
  /** Listen again can work on the same tab (a click in the panel grants nothing, so only while the icon click's grant lasts). */
  canListenAgain: boolean;
  /** The key needs fixing, in Privacy & data. */
  keyTrouble: boolean;
  /** The viewer changed mode, search or key: what the new settings still need is shown too. */
  settingsChanged: boolean;
}

// ---- Inputs -----------------------------------------------------------------

export type SessionInput =
  | { type: 'start'; tabId: number; page: PageContext; settings: SessionSettings }
  | { type: 'caption'; tabId: number; segment: CaptionSegment }
  /** Speech-to-text of the tab's audio. Shown only while captions are missing (see `transcriptSource`). */
  | { type: 'on-device-segment'; tabId: number; segment: OnDeviceSegment; from?: AudioSource }
  /** On-device speech-to-text ran on this many seconds of the tab's audio (whatever it heard); for the footer's counters. */
  | { type: 'speech-to-text'; tabId: number; seconds: number; from?: AudioSource }
  /** Whether the tab's audio is flowing (playing and not silent). The switch to the on-device transcript counts only that time. */
  | { type: 'audio'; tabId: number; flowing: boolean; from?: AudioSource }
  /** How the tab's audio is being captured now (the page's player, a blocked player, tabCapture). */
  | { type: 'audio-capture'; tabId: number; capture: AudioCapture }
  /** The viewer's "Check this" on a transcript line (GLOSSARY: forced check). */
  | { type: 'force-check'; lineId: string }
  /** The viewer's answer to "Who said this?" on a card: re-checks that sentence's waiting claims with this speaker. After Stop too. */
  | { type: 'speaker-answer'; cardId: string; name: string }
  | { type: 'stop'; reason: StopReason }
  /** The viewer opened a source's link from a card (its cleaned URL). Accepted after Stop too. */
  | { type: 'source-opened'; url: string }
  /** The tab moved to another page on the same site; listening carries on there. */
  | { type: 'page'; tabId: number; page: PageContext }
  /** Clear now: forget the transcript and cards. Listening, if on, carries on. */
  | { type: 'clear' }
  /**
   * Voice separation's result for a stretch of the tab's audio (the model
   * worker's): who spoke when, and voices it found to be the same. `failed`
   * when it couldn't run there; the stretch then has no voices.
   */
  | {
      type: 'voices';
      tabId: number;
      from?: AudioSource;
      span: { start: number; end: number };
      turns: VoiceTurn[];
      merged?: Array<{ voice: VoiceId; into: VoiceId }>;
      failed?: true;
    }
  /** The viewer's answer to "Who is this?": the voice's name. Two voices given one name are merged. */
  | { type: 'voice-name'; voice: VoiceId; name: string }
  /** Skip on "Who is this?". */
  | { type: 'voice-skip'; voice: VoiceId }
  /** "Tell voices apart for this video" (captioned pages). */
  | { type: 'separate-voices' }
  /**
   * The viewer forgot the key or switched mode: a stopped session's settings
   * are no longer agreed to, so nothing more is sent with them and its
   * speaker prompts close.
   */
  | { type: 'settings-withdrawn' };

// ---- Outputs ----------------------------------------------------------------

/** What changed. Every event carries its session and a gap-free sequence number. */
export type SessionChange =
  | { type: 'started'; tabId: number; page: PageContext; startedAt: number }
  | { type: 'line'; line: TranscriptLine }
  /** Claim breakdown found parts of a line with no checkable claim. */
  | { type: 'line-skipped'; lineId: string; parts: SkippedPart[] }
  /** A card appeared or changed; it carries the whole card. */
  | { type: 'card'; card: Card }
  /** A card went away: its sentence held no claim after all. */
  | { type: 'card-removed'; cardId: string }
  /** The transcript now comes from somewhere else: captions stopped, or came back. */
  | { type: 'transcript-source'; source: TranscriptSource }
  /** The tab's audio is captured another way: the player blocks direct listening, or tabCapture took over. */
  | { type: 'audio-capture'; capture: AudioCapture }
  | { type: 'stopped'; reason: StopReason; stoppedAt: number }
  /** A source gets its "opened" mark, on every card that shows it. */
  | { type: 'source-opened'; url: string }
  /** Listening moved on to a new page in the same tab. */
  | { type: 'page'; page: PageContext }
  /** Clear now emptied the transcript and cards. */
  | { type: 'cleared' }
  /** A line's voice became known (a caption's, once its audio was separated). */
  | { type: 'line-voice'; lineId: string; voice: VoiceId }
  /** A voice was first heard, named, skipped or merged. */
  | { type: 'voice'; voice: Voice }
  /** Voice separation went on or off. */
  | { type: 'voice-separation'; on: boolean }
  /** The session's counters changed; it carries all of them. */
  | { type: 'counters'; counters: SessionCounters };

export type SessionEvent = SessionChange & { sessionId: string; seq: number };

/**
 * Everything the viewer can see about a session. It is exactly the fold of the
 * session's events (see `applyEvent`), so a snapshot plus later events always
 * reproduces the live state.
 */
export interface SessionView {
  sessionId: string | null;
  /** The `seq` of the last event folded in; 0 before any. */
  seq: number;
  status: SessionStatus;
  lines: TranscriptLine[];
  /** In the order the claims were said. */
  cards: Card[];
  /** Where new transcript lines come from: captions first, the on-device transcript while they're missing. */
  transcriptSource: TranscriptSource;
  /** How the tab's audio is captured; a blocked player shows "This player blocks direct listening". */
  audioCapture: AudioCapture;
  /** Links of the sources the viewer has opened this session, in the order opened. */
  opened: string[];
  /**
   * Whether voices are told apart: on while the transcript comes from on-device
   * speech-to-text, or once the viewer asked for it on this video.
   */
  voiceSeparation: boolean;
  /** The voices heard on this page, in the order first heard. */
  voices: Voice[];
  counters: SessionCounters;
}

/**
 * What the session has used so far: the footer's estimate (src/footprint) is
 * made from these alone. They count from `started` and survive Clear now and
 * a new page, since what was used was used. Calls count once answered, retries
 * and checks cut off by Clear now included.
 */
export interface SessionCounters {
  /** LLM prompts the provider's model answered (cloud mode). */
  cloudCalls: number;
  /** Their tokens in and out, as the provider's replies said (`usage`). */
  cloudTokensIn: number;
  cloudTokensOut: number;
  /** What the provider billed for the calls whose replies gave a price (`cost.usd`), in USD. */
  cloudBilledUsd: number;
  /** How many calls gave that price; the rest are priced from their tokens. */
  cloudBilledCalls: number;
  /** LLM prompts Gemini Nano answered on this device (local mode). */
  onDeviceCalls: number;
  /** Their tokens in and out, estimated from the text (Nano doesn't say). */
  onDeviceTokensIn: number;
  onDeviceTokensOut: number;
  /** Seconds Nano spent answering them. */
  onDeviceSeconds: number;
  /** Searches each search answered: the provider's (cloud mode, or local mode's choice) and TinyFish's. */
  veniceSearches: number;
  tinyfishSearches: number;
  /** Claims that reached a label. */
  claims: number;
  /** Minutes of the tab's audio on-device speech-to-text ran on. */
  speechToTextMinutes: number;
  /** Minutes of the tab's audio voice separation ran on. */
  voiceSeparationMinutes: number;
}

// ---- Platform dependencies (injected) ---------------------------------------

export type TimerHandle = number | object;

export interface Clock {
  /** Milliseconds since epoch. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/**
 * The on-device claim filter (the model worker's client). It runs before any
 * LLM sees a sentence, and leans toward letting borderline sentences through.
 */
export interface ClaimFilter {
  /** Whether the sentence may hold a checkable claim. Rejects if the model can't run. */
  passes(sentence: string): Promise<boolean>;
}

/** Everything the session needs from the platform. */
export interface SessionDeps {
  clock: Clock;
  /** For the provider's LLM and the chosen search, and nothing else. */
  fetch: typeof fetch;
  /**
   * Chrome's `LanguageModel` (Gemini Nano), for local mode. Absent where the
   * browser has none; local mode then stops at once with `local-model-unavailable`.
   */
  languageModel?: LanguageModelFactory;
  /** The source-ratings data. Defaults to the bundled MBFC snapshot. */
  ratings?: RatingsSnapshot;
  /** Drops sentences with no checkable claim. Without one, every sentence goes to claim breakdown. */
  claimFilter?: ClaimFilter;
  /**
   * Voice separation can run here (the model worker's). Without it voices are
   * never told apart, and "Tell voices apart for this video" isn't offered.
   */
  separatesVoices?: boolean;
  /** Makes session ids. Defaults to `crypto.randomUUID`. */
  newId?: () => string;
}
