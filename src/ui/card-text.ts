// The words and symbols a verdict card shows, and the text "Copy with sources"
// puts on the clipboard. Pure functions of a card, shared by every view that
// draws cards (the Claims stream now, the Full transcript later).

import type { Card, CheckStage, Claim, Label, SkippedPart, SkipReason, TranscriptSource, Verdict } from '../session/types';

/** The glyph beside each label, so a label is never told by colour alone. */
export const GLYPH: Record<Label, string> = { True: '✓', Misleading: '◐', False: '✕', Unverified: '?' };

/** Where transcript words came from, as each line and the panel say it. */
export const SOURCE_TEXT: Record<TranscriptSource, string> = { captions: 'Captions', 'on-device': 'On-device transcript' };

/** What a check that is still running is doing. */
export const STAGE_TEXT: Record<CheckStage, string> = {
  breakdown: 'Pulling out the claim…',
  search: 'Searching sources left, center and right…',
  weighing: 'Weighing sources…',
};

/** Media seconds as m:ss, or h:mm:ss past an hour. */
export function mediaClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The claim as the card shows it in bold: the claim once pulled out, the sentence before that. */
export function claimText(card: Card): string {
  return card.claim?.literal ?? card.sentence;
}

const SKIPPED_AS: Record<SkipReason, string> = {
  opinion: 'an opinion',
  'value judgement': 'a value judgement',
  hyperbole: 'hyperbole',
  'rhetorical question': 'a rhetorical question',
  prediction: 'a prediction',
  promise: 'a promise',
  'no checkable fact': 'a skipped statement',
  'not flagged as a claim': 'a skipped statement',
  'not self-contained': 'a skipped statement',
  'too vague to check': 'a skipped statement',
  'not worth checking': 'a skipped statement',
};

/**
 * Why the transcript skipped part of a line: the reason, and for a claim
 * that isn't self-contained the words no one named ("not self-contained:
 * can’t tell who “they” are").
 */
export function skippedText(part: SkippedPart): string {
  if (part.reason !== 'not self-contained' || !part.unclear) return part.reason;
  return `not self-contained: can’t tell who or what “${part.unclear.replace(/^["“”']+|["“”']+$/g, '')}” is`;
}

/**
 * The speaker's own words, when the card shows its claim rewritten to stand
 * alone ("Their policies…" as "The Biden administration's policies…"); null
 * when the claim is the sentence as said.
 */
export function asSaid(card: Card): string | null {
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return card.claim && words(card.claim.literal) !== words(card.sentence) ? card.sentence : null;
}

/** The card's tags: "Premise of a prediction · “<line>”" and "You asked to check this". */
export function cardTags(card: Card): string[] {
  const tags: string[] = [];
  const claim: Claim | null = card.claim;
  if (claim?.premiseOf) {
    const quoted = claim.premiseOf.replace(/^["“”']+|["“”']+$/g, '');
    tags.push(`Premise of ${SKIPPED_AS[claim.premiseKind ?? 'no checkable fact']} · “${quoted}”`);
  }
  if (card.forced) tags.push('You asked to check this');
  return tags;
}

/** "Said by Maria Lopez", when the card knows who said the claim. */
export function speakerText(card: Card): string | null {
  return card.speaker ? `Said by ${card.speaker.name}` : null;
}

/** The collapsed card's hint at what opening it shows, e.g. "What’s missing · 4 sources". */
export function detailSummary(verdict: Verdict): string {
  const n = verdict.sources.length;
  const sources = n === 0 ? 'No sources' : `${n} source${n === 1 ? '' : 's'}`;
  return showsMissing(verdict) ? `What’s missing · ${sources}` : sources;
}

/** Only Misleading says what's missing. */
export function showsMissing(verdict: Verdict): verdict is Verdict & { missing: string } {
  return verdict.label === 'Misleading' && !!verdict.missing;
}

/** e.g. "Judged as of Jun 27, 2024 (when said)". */
export function judgedAsOfText(verdict: Verdict): string {
  const [y, m, d] = verdict.judgedAsOf.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `Judged as of ${date} (${verdict.judgedAsOfBasis === 'recording' ? 'when said' : 'the day it was checked'})`;
}

/**
 * A link to the video at a moment, where the site has a way to say so in the
 * address (YouTube's `t`); otherwise the page's own address.
 */
export function videoLinkAt(pageUrl: string, seconds: number): string {
  try {
    const url = new URL(pageUrl);
    const host = url.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtube.com' || host === 'youtu.be') {
      url.searchParams.set('t', `${Math.max(0, Math.floor(seconds))}s`);
      return url.href;
    }
    return url.href;
  } catch {
    return pageUrl;
  }
}

/**
 * What "Copy with sources" puts on the clipboard: the claim, the label and
 * conclusion, what's missing, every source link (context-only ones marked)
 * and the video timestamp, so a
 * verdict never travels without its evidence.
 */
export function copyWithSources(card: Card, verdict: Verdict, pageUrl: string): string {
  const said = asSaid(card);
  const lines = [
    `“${claimText(card)}”`,
    ...(card.speaker ? [speakerText(card)!] : []),
    ...(said ? [`As said: “${said}”`] : []),
    `ClaimCatcher: ${verdict.label}. ${verdict.conclusion}`,
  ];
  if (showsMissing(verdict)) lines.push(`What’s missing: ${verdict.missing}`);
  if (verdict.sources.length > 0) {
    lines.push('Sources:', ...verdict.sources.map((s) => `- ${s.title} (${s.domain}): ${s.url}`));
  } else {
    lines.push('Sources: none found');
  }
  const context = verdict.context ?? [];
  if (context.length > 0) {
    lines.push('Context only, not used for the verdict:', ...context.map((s) => `- ${s.title} (${s.domain}): ${s.url}`));
  }
  lines.push(`Said at ${mediaClock(card.time)}: ${videoLinkAt(pageUrl, card.time)}`, judgedAsOfText(verdict));
  return lines.join('\n');
}

/** What a screen reader hears when a card gets its label. */
export function announcement(card: Card, verdict: Verdict): string {
  const said = `${verdict.label}: ${claimText(card)}. ${verdict.conclusion}`;
  return card.whoSaid ? `${said} Who said this?` : said;
}
