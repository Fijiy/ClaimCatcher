// Save session: one local file with everything the viewer saw in a session.
// The side panel builds it from its copy of the session (the offscreen
// document may have closed by then) and saves it through the browser's own
// download flow. Nothing here sends anything anywhere.

import { voiceText } from './view';
import type { CardSource, CheckStage, ContextSource, Label, PageContext, SessionView, SkippedPart, StopReason } from './types';

export interface SessionFile {
  format: 'ClaimCatcher session';
  version: 1;
  /** When the file was saved (ISO 8601). */
  savedAt: string;
  page: PageContext | null;
  startedAt: string | null;
  /** Null if it was saved while still listening. */
  stoppedAt: string | null;
  stopReason: StopReason | null;
  transcript: Array<{
    /** Seconds of media time, and the same as m:ss. */
    time: number;
    at: string;
    /** When ClaimCatcher heard it (ISO 8601). */
    heardAt: string;
    source: 'Captions' | 'On-device transcript';
    text: string;
    skipped: SkippedPart[];
    /** Who spoke it when voices were told apart: the name the viewer gave, else "Voice A"…; null otherwise. */
    voice: string | null;
  }>;
  claims: Array<{
    time: number;
    at: string;
    sentence: string;
    /** Null while the claim was still being pulled out. */
    claim: string | null;
    implied: string | null;
    premiseOf: string | null;
    /** Who said it, when the page, the viewer or the voice the viewer named says (GLOSSARY: speaker). */
    speaker: string | null;
    /** The viewer asked for this check ("Check this"). */
    forced: boolean;
    verdict: {
      label: Label;
      conclusion: string;
      missing: string | null;
      judgedAsOf: string;
      /** The evidence the verdict was weighed on, with ratings and stances. */
      sources: CardSource[];
      /** Partisan sources shown for context only. */
      context: ContextSource[];
    } | null;
    /** Only for a claim still being checked when the file was saved. */
    checking?: CheckStage;
  }>;
}

const SOURCE_NAMES = { captions: 'Captions', 'on-device': 'On-device transcript' } as const;

export function exportSession(view: SessionView, savedAt: number): SessionFile {
  const status = view.status;
  return {
    format: 'ClaimCatcher session',
    version: 1,
    savedAt: iso(savedAt),
    page: status.state === 'idle' ? null : status.page,
    startedAt: status.state === 'idle' ? null : iso(status.startedAt),
    stoppedAt: status.state === 'stopped' ? iso(status.stoppedAt) : null,
    stopReason: status.state === 'stopped' ? status.reason : null,
    transcript: view.lines.map((line) => ({
      time: line.time,
      at: mediaTime(line.time),
      heardAt: iso(line.heardAt),
      source: SOURCE_NAMES[line.source],
      text: line.text,
      skipped: line.skipped ?? [],
      voice: voiceText(view.voices, line.voice) ?? null,
    })),
    claims: view.cards.map((card) => {
      const done = card.check.state === 'done' ? card.check.verdict : null;
      return {
        time: card.time,
        at: mediaTime(card.time),
        sentence: card.sentence,
        claim: card.claim?.literal ?? null,
        implied: card.claim?.implied ?? null,
        premiseOf: card.claim?.premiseOf ?? null,
        speaker: card.speaker?.name ?? null,
        forced: card.forced ?? false,
        verdict: done && {
          label: done.label,
          conclusion: done.conclusion,
          missing: done.missing,
          judgedAsOf: done.judgedAsOf,
          sources: done.sources,
          context: done.context ?? [],
        },
        ...(card.check.state === 'checking' ? { checking: card.check.stage } : {}),
      };
    }),
  };
}

/** e.g. claimcatcher-session-2026-10-26-0905.json, in the viewer's local time. */
export function sessionFileName(savedAt: number): string {
  const d = new Date(savedAt);
  const two = (n: number) => String(n).padStart(2, '0');
  return `claimcatcher-session-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.json`;
}

/** Media seconds as m:ss, or h:mm:ss past an hour. */
export function mediaTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
