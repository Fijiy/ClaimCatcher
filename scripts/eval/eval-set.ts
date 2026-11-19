// The verdict gate's cases: the evaluation set's rated claims (eval/clips.json),
// each with its frozen search evidence and its answer from the audited key.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectEvidence } from '../../src/session/checks/evidence';
import type { SearchResult } from '../../src/session/checks/provider';
import type { ResultSet } from '../../src/session/checks/search';
import type { VerdictInput } from '../../src/session/checks/verdict';
import type { RatingsSnapshot } from '../../src/session/sources/ratings';
import type { Label } from '../../src/session/types';
import type { SearchCase } from './search-compare';

/** A rated claim, ready for the verdict step. */
export interface GateCase {
  /** `<clip id>#<claim index>`, as in eval/clips.json. */
  id: string;
  clip: string;
  /** The judged-as-of date: the day the claim was said. */
  date: string;
  /** The audited key's label. No claim in the set is rated Unverified. */
  truth: Exclude<Label, 'Unverified'>;
  /** Every label the audited key accepts (the truth first). */
  accept: Label[];
  /** How the professional rating was mapped: by a firm rule or by judgment (eval/README.md). */
  basis: 'firm' | 'judgment';
  /** What the shipped verdict step is given. */
  input: VerdictInput;
}

interface CaseFile {
  case_id: string;
  clip: string;
  date: string;
  event: string;
  /** "Joe Biden (D, President, Democratic presumptive nominee)". */
  speaker: string;
  claim: string;
  /** About 30 s of what was said before the claim (from a Whisper draft). */
  context: string;
  label: GateCase['truth'];
  basis: GateCase['basis'];
}

type KeyAudit = Record<string, { label: GateCase['truth']; accept: Label[] } | string>;

interface EvidenceFile {
  case_id: string;
  /** A: the claim verbatim plus the speaker's surname; B: a neutral fact query. */
  queries: { A: string; B: string };
  results: Array<{ q: 'A' | 'B'; rank: number; title: string; url: string; domain: string; published: string | null; snippet: string }>;
}

interface ClipFile {
  id: string;
  video: { uploader?: string };
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T;

/** The bundled MBFC snapshot, as the extension classifies sources with it. */
export function bundledRatingsFromDisk(): RatingsSnapshot {
  const path = 'src/session/sources/mbfc-snapshot.json';
  if (!existsSync(join(ROOT, path))) throw new Error(`${path} is missing: run \`pnpm run postinstall\` (or \`pnpm ratings\`) first`);
  return json<RatingsSnapshot>(path);
}

/**
 * The 29 rated claims, each turned into the shipped verdict step's input the
 * way the pipeline would: the frozen search results for its two queries go
 * through the shipped evidence selection (classify, drop, top 5 × 400 chars,
 * alternating fact, claim), after dropping results published after the day
 * the claim was said (some packs hold later fact-checks of a repeated claim).
 *
 * Stand-ins for what a live check has and the gate doesn't: the claim's own
 * words are the literal claim (claim breakdown isn't scored here, so there's
 * no implied claim), the page title is the event and the channel the
 * uploader. The speaker is named, as when the page or the viewer settled it.
 */
export function loadVerdictCases(ratings: RatingsSnapshot = bundledRatingsFromDisk()): GateCase[] {
  const audit = json<KeyAudit>('eval/verdicts/key-audit.json');
  const clips = new Map(json<ClipFile[]>('eval/clips.json').map((clip) => [clip.id, clip]));
  return json<CaseFile[]>('eval/verdicts/cases.json').map((c): GateCase => {
    const audited = audit[c.case_id];
    const key = typeof audited === 'object' ? audited : { label: c.label, accept: [c.label] };
    const pack = json<EvidenceFile>(`eval/verdicts/evidence/${c.case_id.replace('#', '__')}.json`);
    const asOf = (r: EvidenceFile['results'][number]) => !r.published || r.published.slice(0, 10) <= c.date;
    const results = (q: 'A' | 'B') =>
      pack.results
        .filter((r) => r.q === q && asOf(r))
        .sort((a, b) => a.rank - b.rank)
        .map(({ title, url, domain, snippet, published }): SearchResult => ({ title, url, domain, snippet, published }));
    const sets: ResultSet[] = [
      { query: 'fact', results: results('B') },
      { query: 'claim', results: results('A') },
    ];
    const uploader = clips.get(c.clip)?.video.uploader?.replace(/\s*\(.*$/, '').trim();
    return {
      id: c.case_id,
      clip: c.clip,
      date: c.date,
      truth: key.label,
      accept: [key.label, ...key.accept.filter((l) => l !== key.label)],
      basis: c.basis,
      input: {
        literal: c.claim,
        implied: '',
        context: c.context,
        title: c.event,
        ...(uploader ? { channel: uploader } : {}),
        speaker: c.speaker.replace(/\s*\(.*$/, ''),
        evidence: selectEvidence(sets, ratings).evidence,
        judgedAsOf: c.date,
        // Said that day, as a page's recording date gives it (#46).
        saidOn: c.date,
      },
    };
  });
}

/**
 * The rated claims' searches for `pnpm eval:search`: each claim's two
 * queries as the frozen evidence was searched (B, the neutral fact query;
 * A, the claim verbatim plus the speaker's surname), with the gate's frozen
 * top 5 to compare with.
 */
export function loadSearchCases(ratings: RatingsSnapshot = bundledRatingsFromDisk()): SearchCase[] {
  return loadVerdictCases(ratings).map((c) => {
    const pack = json<EvidenceFile>(`eval/verdicts/evidence/${c.id.replace('#', '__')}.json`);
    return { id: c.id, date: c.date, queries: { fact: pack.queries.B, claim: pack.queries.A }, frozen: c.input.evidence };
  });
}
