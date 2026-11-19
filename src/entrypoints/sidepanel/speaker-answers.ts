// How a card's "Who said this?" and "Who is this?" answers reach the session,
// and how cards and lines show a voice: the panel provides this once
// (App.svelte), and ClaimCard.svelte and TranscriptView.svelte use it. The
// session decides which prompts a card shows (after Stop too); the panel only
// passes the answers on. Without a provider (a card rendered on its own) the
// prompts show but answers go nowhere.

import { getContext, setContext } from 'svelte';
import type { VoiceId } from '../../session/types';

export interface SpeakerAnswers {
  /** The viewer named who said the card's claim. */
  answer(cardId: string, name: string): void;
  /** "Who is this?": the viewer named a voice. */
  nameVoice(voice: VoiceId, name: string): void;
  /** "Who is this?": Skip. */
  skipVoice(voice: VoiceId): void;
  /** "Tell voices apart for this video". */
  separateVoices(): void;
  /** "Voice A", or the name the viewer gave it. */
  voiceText(voice: VoiceId | undefined): string | undefined;
}

const KEY = Symbol('speaker-answers');
const NONE: SpeakerAnswers = {
  answer: () => {},
  nameVoice: () => {},
  skipVoice: () => {},
  separateVoices: () => {},
  voiceText: () => undefined,
};

export function provideSpeakerAnswers(answers: SpeakerAnswers) {
  setContext(KEY, answers);
}

export function speakerAnswers(): SpeakerAnswers {
  return getContext<SpeakerAnswers | undefined>(KEY) ?? NONE;
}
