// Runs the check stages for one sentence and reports each card's progress:
//
//   1. breakdown.ts    claim breakdown (LLM): stand-alone claims, the date
//                      said and the page's one speaker given  stage "breakdown"
//      tidy.ts         code checks on its reply: stray words, duplicates,
//                      premises, unresolved words, years in the queries
//      resolve.ts      one try at naming words left unresolved ("they"),
//                      from the context and page only, word for word
//      review.ts       the claim review (LLM, one prompt per claim, not for
//                      forced checks): keeps specific, self-contained,
//                      check-worthy claims; the rest are skipped on the line
//      speaker.ts      the speaker gate: a claim that depends on an unknown
//                      speaker asks "Who said this?" and is Unverified until
//                      the viewer answers, which re-checks it
//   2. search.ts       the provider's search        stage "search"
//      balance.ts      one more search if the top 5 lean one way
//   3. evidence.ts     classify (sources/), top 5 × 400 chars, full weight first
//   4. verdict.ts      one verdict prompt per claim  stage "weighing"
//   5. consistency.ts  the code rule on the label
//
// Each stage lives in its own file; this one only sequences them and applies
// the failure policy: a rejected key or no credit ends the check and asks the
// session to stop listening; any other failure is retried once, then the card
// ends as Unverified saying it couldn't be checked. A card never hangs.

import type { Card, JudgedAsOf, PageContext, SkippedPart, SkipReason, Speaker, Verdict, VoiceId } from '../types';
import { breakDown, type BreakdownInput, type BrokenDownClaim } from './breakdown';
import { searchOtherSide } from './balance';
import { applyConsistencyRule } from './consistency';
import { selectEvidence } from './evidence';
import { failureKind, ProviderError, type FailureKind, type JsonModel, type SearchProvider } from './provider';
import { searchClaim } from './search';
import { resolveReference } from './resolve';
import { reviewClaim } from './review';
import { pageSpeaker, speakerFromPage, unresolvedConclusion, unresolvedContext } from './speaker';
import { tidyClaims } from './tidy';
import type { RatingsSnapshot } from '../sources/ratings';
import type { Sentence } from './sentences';
import { judge, type ModelVerdict, type VerdictInput } from './verdict';

export interface CheckDeps {
  model: JsonModel;
  search: SearchProvider;
  page: PageContext;
  /** The MBFC snapshot that classifies search results. */
  ratings: RatingsSnapshot;
  /** The judged-as-of date for a check starting now: the recording date, else today. */
  judgedAsOf: () => JudgedAsOf;
  /** The names "Who said this?" offers right now. */
  speakerNames: () => string[];
}

/** How the pipeline tells the session what happened. */
export interface CheckReport {
  card(card: Card): void;
  removeCard(cardId: string): void;
  skipped(lineId: string, parts: SkippedPart[]): void;
  /** The key can't be used (401) or has no credit (402): listening must stop. */
  fatal(kind: Exclude<FailureKind, 'failed'>): void;
  /**
   * A card is asking "Who said this?". `recheck` runs its check again, from
   * claim breakdown on, with the speaker the viewer named.
   */
  awaitSpeaker(cardId: string, recheck: (speaker: Speaker) => Promise<void>): void;
}

export interface CheckOptions {
  /**
   * The viewer asked for this check (a forced check). It still runs every
   * stage from claim breakdown on and ends in one of the four labels: if
   * breakdown finds no claim, the sentence's own words are checked as one.
   */
  forced?: boolean;
  /**
   * Who said the sentence, when the session already knows: the hook for a
   * named voice. Breakdown is told, and no claim asks "Who said this?".
   */
  speaker?: Speaker;
  /** The voice that said the sentence (voice separation). Every card carries it. */
  voice?: VoiceId;
  /**
   * The voice's first claim: the first card asks "Who is this?" with these
   * names, and claims that depend on the speaker wait for that answer
   * (Unverified meanwhile) instead of asking "Who said this?".
   */
  askVoice?: string[];
  /**
   * The voice's "Who is this?" is already open (on an earlier claim): claims
   * that depend on the speaker wait for that answer too, instead of asking
   * "Who said this?".
   */
  awaitsVoice?: boolean;
}

export async function checkSentence(sentence: Sentence, deps: CheckDeps, report: CheckReport, options: CheckOptions = {}): Promise<void> {
  const forced = options.forced === true;
  const base = {
    sentenceId: sentence.id,
    lineId: sentence.lineId,
    time: sentence.time,
    sentence: sentence.text,
    ...(forced ? { forced } : {}),
    ...(options.voice ? { voice: options.voice } : {}),
  };
  const first: Card = { ...base, id: `${sentence.id}.1`, claim: null, check: { state: 'checking', stage: 'breakdown' } };
  report.card(first);

  const judgedAsOf = deps.judgedAsOf();
  const onDevice = deps.model.onDevice === true;
  // The one person the page names speaks, unless the session knows better (the viewer, a named voice).
  const pagePerson = options.speaker ? null : pageSpeaker(deps.page, onDevice);
  let found: FoundClaims;
  try {
    found = await findClaims(deps.model, {
      sentence,
      page: deps.page,
      judgedAsOf,
      ...(options.speaker ? { speaker: options.speaker } : pagePerson ? { speaker: { name: pagePerson, from: 'page' } } : {}),
      forced,
    });
    // A forced line already shows why it was skipped.
    const shown = forced ? [] : [...found.skipped, ...found.dropped];
    if (shown.length > 0) report.skipped(sentence.lineId, shown);
  } catch (error) {
    return couldNotCheck(first, error, judgedAsOf, report);
  }
  const { claims, skipped, peopleNamed } = found;

  if (claims.length === 0) {
    report.removeCard(first.id);
    return;
  }
  // The page's one person, if breakdown's own reading of the page names no one else.
  const fromThePage = pagePerson ? speakerFromPage(pagePerson, peopleNamed, deps.page, onDevice) : null;
  await Promise.all(
    claims.map((claim, i) => {
      const card: Card = {
        ...base,
        id: `${sentence.id}.${i + 1}`,
        claim: {
          literal: claim.literal,
          implied: claim.implied,
          premiseOf: claim.premiseOf,
          ...premiseKind(claim.premiseOf, skipped),
        },
        ...(options.askVoice && options.voice && i === 0 ? { whoIsThis: { voice: options.voice, names: options.askVoice } } : {}),
        check: { state: 'checking', stage: 'search' },
      };
      const speaker = options.speaker ?? fromPage(claim, peopleNamed, deps) ?? (fromThePage ? { name: fromThePage, from: 'page' as const } : undefined);
      if (claim.unresolved) return report.card(unverified(speaker ? { ...card, speaker } : card, unresolvedContext(claim.unresolved), judgedAsOf));
      if (claim.speaker.depends && !speaker) return askWhoSaid({ card, claim, sentence, deps, report }, !options.askVoice && !options.awaitsVoice);
      return checkClaim({ card: speaker ? { ...card, speaker } : card, claim, sentence, deps, report });
    }),
  );
}

/** What claim breakdown, its code checks and the claim review found in one sentence. */
export interface FoundClaims {
  /** The claims after breakdown and its code checks, before the review: what used to become cards. */
  found: BrokenDownClaim[];
  /** The claims that become cards. */
  claims: BrokenDownClaim[];
  /** Breakdown's skipped parts. */
  skipped: SkippedPart[];
  /** Claims dropped as not self-contained or by the review, as skipped parts for the line. */
  dropped: SkippedPart[];
  /** Everyone breakdown says the title and channel name. */
  peopleNamed: string[];
}

/**
 * Stage 1 for one sentence: claim breakdown (told the day it was said and
 * any speaker), its code checks (tidy.ts), then the claim review on each
 * claim. A forced check skips the review, keeps claims with words no one
 * named (they end Unverified, unsearched), and checks the sentence's own
 * words if nothing else. The evaluation harness (scripts/eval/review.ts)
 * runs this same function.
 */
export async function findClaims(
  model: JsonModel,
  input: { sentence: Pick<Sentence, 'text' | 'context'>; page: PageContext; judgedAsOf: JudgedAsOf; speaker?: Speaker; forced?: boolean; only?: string },
): Promise<FoundClaims> {
  const breakdown = await attempt(() =>
    breakDown(model, breakdownInput(input.sentence, input.page, input.judgedAsOf, { forced: input.forced, speaker: input.speaker, only: input.only })),
  );
  const tidied = tidyClaims(breakdown, { sentence: input.sentence.text, context: input.sentence.context, saidOn: input.judgedAsOf.date });
  // One more try at words breakdown left unresolved, from the context and page only.
  const resolved = await Promise.all(tidied.unresolved.map((claim) => resolveClaim(model, claim, input)));
  const selfContained = [...tidied.claims, ...resolved.filter((c) => !c.unresolved)];
  const unresolved = resolved.filter((c) => !!c.unresolved);
  const found = [...selfContained, ...unresolved];
  const base = { found, skipped: breakdown.skipped, peopleNamed: breakdown.peopleNamed };
  if (input.forced) {
    // The viewer asked: no review, and words no one named end the card Unverified rather than vanish.
    return { ...base, claims: found.length > 0 ? found : [ownWords(input.sentence.text)], dropped: [] };
  }
  const notSelfContained = unresolved.map((c): SkippedPart => ({ text: c.literal, reason: 'not self-contained', unclear: c.unresolved!, claim: true }));
  const reviewed = await reviewAll(selfContained, model, input.judgedAsOf, input.speaker?.name);
  // A fact the review found words in that no one named ("Their policies…"): one try at naming them.
  const named = await Promise.all(reviewed.unclear.map((c) => resolveClaim(model, c, input)));
  const dropped = reviewed.dropped.filter((part) => !named.some((c, i) => !c.unresolved && reviewed.unclear[i]!.literal === part.text));
  return { ...base, claims: [...reviewed.kept, ...named.filter((c) => !c.unresolved)], dropped: [...notSelfContained, ...dropped] };
}

/**
 * A claim with words breakdown couldn't resolve, resolved from the context
 * and page if they say who or what (resolve.ts); else as it was. A failed
 * call leaves it unresolved; a refused key still ends the check.
 */
async function resolveClaim(
  model: JsonModel,
  claim: BrokenDownClaim,
  input: { sentence: Pick<Sentence, 'text' | 'context'>; page: PageContext },
): Promise<BrokenDownClaim> {
  const words = claim.unresolved!;
  const literal = await attempt(() =>
    resolveReference(model, {
      claim: claim.literal,
      words,
      sentence: input.sentence.text,
      context: input.sentence.context,
      title: input.page.title,
      ...(input.page.channel ? { channel: input.page.channel } : {}),
      ...(input.page.description ? { description: input.page.description } : {}),
    }),
  ).catch((error: unknown) => {
    if (failureKind(error) !== 'failed') throw error;
    return null;
  });
  if (!literal) return claim;
  const referent = literal;
  const swap = (query: string) => (query.toLowerCase().includes(words.toLowerCase()) ? '' : query);
  return {
    ...claim,
    literal: referent,
    unresolved: null,
    queries: { fact: swap(claim.queries.fact) || referent, claim: swap(claim.queries.claim) || referent },
  };
}

/**
 * The claim review (review.ts) on each claim, one prompt each: the kept ones,
 * and the dropped ones as skipped parts for the line. A review that fails
 * twice keeps its claim: better checked than lost. A refused key still ends
 * the check.
 */
async function reviewAll(claims: BrokenDownClaim[], model: JsonModel, judgedAsOf: JudgedAsOf, speaker: string | undefined) {
  const reviews = await Promise.all(
    claims.map((claim) =>
      attempt(() =>
        reviewClaim(model, { claim: claim.literal, ...(judgedAsOf.basis === 'recording' ? { saidOn: judgedAsOf.date } : {}), ...(speaker ? { speaker } : {}) }),
      ).catch((error: unknown) => {
        if (failureKind(error) !== 'failed') throw error;
        return { keep: true } as const;
      }),
    ),
  );
  const kept: BrokenDownClaim[] = [];
  const dropped: SkippedPart[] = [];
  /** Checkable facts but for words no one named: worth one try at naming them. */
  const unclear: BrokenDownClaim[] = [];
  claims.forEach((claim, i) => {
    const review = reviews[i]!;
    if (review.keep) kept.push(claim);
    else dropped.push({ text: claim.literal, reason: review.reason, ...(review.unclear ? { unclear: review.unclear } : {}), claim: true });
    if (!review.keep && review.unclear && review.fact) unclear.push({ ...claim, unresolved: review.unclear });
  });
  return { kept, dropped, unclear };
}

function breakdownInput(
  sentence: Pick<Sentence, 'text' | 'context'>,
  page: PageContext,
  judgedAsOf: JudgedAsOf,
  extra: { forced?: boolean; speaker?: Speaker; only?: string },
): BreakdownInput {
  return {
    sentence: sentence.text,
    context: sentence.context,
    title: page.title,
    channel: page.channel,
    description: page.description,
    saidOn: { date: judgedAsOf.date, known: judgedAsOf.basis === 'recording' },
    ...(extra.speaker ? { speaker: extra.speaker.name, speakerFrom: extra.speaker.from === 'page' ? ('page' as const) : ('viewer' as const) } : {}),
    ...(extra.only ? { only: extra.only } : {}),
    ...(extra.forced ? { forced: true } : {}),
  };
}

/** The speaker breakdown named, if the page settles it (speaker.ts); never one taken from what was said. */
function fromPage(claim: BrokenDownClaim, peopleNamed: string[], deps: CheckDeps): Speaker | undefined {
  const name = speakerFromPage(claim.speaker.name, peopleNamed, deps.page, deps.model.onDevice === true);
  return name ? { name, from: 'page' } : undefined;
}

/** One claim's check: the card it shows on, the claim, and what its stages need. */
interface ClaimCheck {
  card: Card;
  claim: BrokenDownClaim;
  sentence: Sentence;
  deps: CheckDeps;
  report: CheckReport;
}

/**
 * The speaker gate: nothing settles who said a claim that depends on it. The
 * card asks "Who said this?" (unless its voice is being asked about: then the
 * answer to "Who is this?" settles it) and is Unverified meanwhile, without a
 * search or a verdict. An answer re-checks it with that speaker.
 */
function askWhoSaid(check: ClaimCheck, ask: boolean) {
  const { card, claim, deps, report } = check;
  const asking: Card = { ...card, ...(ask ? { whoSaid: { names: deps.speakerNames() } } : {}) };
  report.card(unverified(asking, unresolvedConclusion(claim.speaker.words), deps.judgedAsOf()));
  report.awaitSpeaker(card.id, (speaker) => recheck(check, speaker));
}

/** Checks a claim again, from breakdown on, now that the viewer has named its speaker. */
async function recheck({ card, claim, sentence, deps, report }: ClaimCheck, speaker: Speaker) {
  const { whoSaid: _asked, whoIsThis: _voice, ...rest } = card;
  const named: Card = { ...rest, speaker, check: { state: 'checking', stage: 'breakdown' } };
  report.card(named);
  let again: BrokenDownClaim;
  try {
    const judgedAsOf = deps.judgedAsOf();
    const breakdown = await attempt(() => breakDown(deps.model, breakdownInput(sentence, deps.page, judgedAsOf, { speaker, only: claim.literal })));
    again = tidyClaims(breakdown, { sentence: sentence.text, context: sentence.context, saidOn: judgedAsOf.date }).claims[0] ?? claim;
  } catch (error) {
    return couldNotCheck(named, error, deps.judgedAsOf(), report);
  }
  const claimShown = { ...named.claim!, literal: again.literal, implied: again.implied };
  await checkClaim({ card: { ...named, claim: claimShown, check: { state: 'checking', stage: 'search' } }, claim: again, sentence, deps, report });
}

async function checkClaim({ card, claim, sentence, deps, report }: ClaimCheck) {
  const judgedAsOf = deps.judgedAsOf();
  try {
    report.card(card);
    const sets = await searchClaim(deps.search, claim.queries, attempt);
    const balancing = await searchOtherSide(deps.search, claim.queries, selectEvidence(sets, deps.ratings).evidence, deps.ratings, attempt);
    const { evidence, context } = selectEvidence(balancing ? [...sets, balancing] : sets, deps.ratings);
    const shownContext = context.length > 0 ? { context } : {};
    // No label without sources: with nothing to weigh, there is no verdict to ask for.
    if (evidence.length === 0) return report.card(unverified(card, NO_SOURCES, judgedAsOf, shownContext));

    report.card({ ...card, check: { state: 'checking', stage: 'weighing' } });
    const said = await judgeClaim(deps.model, {
      literal: claim.literal,
      implied: claim.implied,
      context: sentence.context,
      title: deps.page.title,
      channel: deps.page.channel,
      ...(card.speaker ? { speaker: card.speaker.name } : {}),
      evidence,
      judgedAsOf: judgedAsOf.date,
      ...(judgedAsOf.basis === 'recording' ? { saidOn: judgedAsOf.date } : {}),
    });

    report.card(
      labelled(
        card,
        {
          label: said.label,
          conclusion: said.conclusion,
          missing: said.missing,
          sources: evidence.map(({ n, title, url, domain, snippet, published, rating, weight, factCheck }) => ({
            n,
            title,
            url,
            domain,
            snippet,
            published,
            rating,
            weight,
            stance: said.stances.get(n) ?? 'neither',
            ...(factCheck ? { factCheck } : {}),
          })),
          ...shownContext,
        },
        judgedAsOf,
      ),
    );
  } catch (error) {
    couldNotCheck(card, error, judgedAsOf, report);
  }
}

/** The conclusion of a claim the search found no usable source for. */
const NO_SOURCES = 'No usable sources were found for this claim.';

/**
 * Stages 4 and 5 for one claim: the verdict prompt (retried once if it fails
 * for any reason but the key), then the consistency rule on its label. The
 * quality gate (scripts/eval/) runs this same function over the evaluation set.
 */
export async function judgeClaim(model: JsonModel, input: VerdictInput): Promise<ModelVerdict> {
  const said = await attempt(() => judge(model, input));
  return { ...said, label: applyConsistencyRule(said.label, said.conclusion) };
}

/**
 * The kind of skipped statement a premise rests on: the skipped part with the
 * same words, ignoring case, quotes and punctuation. None if no part matches.
 */
function premiseKind(premiseOf: string | null, skipped: SkippedPart[]): { premiseKind?: SkipReason } {
  if (!premiseOf) return {};
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const premise = words(premiseOf);
  const part = skipped.find((p) => words(p.text) === premise) ?? skipped.find((p) => {
    const w = words(p.text);
    return w.length > 0 && (w.includes(premise) || premise.includes(w));
  });
  return part ? { premiseKind: part.reason } : {};
}

/** A forced check on words breakdown found no claim in: they are checked as they were said. */
function ownWords(text: string): BrokenDownClaim {
  return { literal: text, unresolved: null, implied: text, premiseOf: null, speaker: { depends: false, words: null, name: null }, queries: { fact: text, claim: text } };
}

/** Runs a provider call, and once more if it fails for any reason but the key. */
async function attempt<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (failureKind(error) !== 'failed') throw error;
    return call();
  }
}

const WHY: Record<FailureKind, string> = {
  'key-rejected': 'the provider rejected the API key',
  'no-credit': 'the API key has no credit left',
  'search-key-rejected': 'the search rejected its API key',
  failed: 'the provider did not answer',
};
/** Local mode's model crashed, hung or broke its schema (nano.ts). */
const ON_DEVICE_FAILED = 'Gemini Nano, the model on this device, failed';

/** The chosen search (not the provider's) failed without saying how. */
const SEARCH_FAILED = 'the search did not answer';

function why(error: unknown): string {
  if (error instanceof ProviderError && error.why) return error.why;
  if (error instanceof ProviderError && error.kind === 'failed' && error.source === 'on-device') return ON_DEVICE_FAILED;
  if (error instanceof ProviderError && error.kind === 'failed' && error.source === 'search') return SEARCH_FAILED;
  return WHY[failureKind(error)];
}

/** The card ends Unverified, saying it couldn't be checked; a refused key or no credit also stops listening. */
function couldNotCheck(card: Card, error: unknown, judgedAsOf: JudgedAsOf, report: CheckReport) {
  report.card(unverified(card, `This couldn't be checked: ${why(error)}.`, judgedAsOf));
  const kind = failureKind(error);
  if (kind !== 'failed') report.fatal(kind);
}

/** The card, Unverified with this conclusion and no sources (any context still shown). */
function unverified(card: Card, conclusion: string, judgedAsOf: JudgedAsOf, extra: Pick<Verdict, 'context'> = {}): Card {
  return labelled(card, { label: 'Unverified', conclusion, missing: null, sources: [], ...extra }, judgedAsOf);
}

/** The card with its label, dated as of `judgedAsOf`. */
function labelled(card: Card, verdict: Omit<Verdict, 'judgedAsOf' | 'judgedAsOfBasis'>, judgedAsOf: JudgedAsOf): Card {
  return { ...card, check: { state: 'done', verdict: { ...verdict, judgedAsOf: judgedAsOf.date, judgedAsOfBasis: judgedAsOf.basis } } };
}
