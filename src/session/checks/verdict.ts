// Stage 4, the verdict: one prompt per claim, never a follow-up. Reasons come
// first (literal claim, implied takeaway, evidence, conclusion), then the
// label, with the reply held to a JSON schema. The system prompt is the local
// prototype's shipped v2.1 (prototype/local-mode-eval), plus each source's
// stance and tier, the judged-as-of date, and the day the claim was said
// (time words in the claim count from it).

import type { Label, Stance } from '../types';
import type { Evidence } from './evidence';
import { ProviderError, type JsonModel, type JsonSchema } from './provider';

export interface VerdictInput {
  literal: string;
  implied: string;
  /** About 30 s of what was said before the claim. */
  context: string;
  title: string;
  channel?: string;
  /** Who said the claim, when the page or the viewer settled it. */
  speaker?: string;
  evidence: Evidence[];
  /** The judged-as-of date, YYYY-MM-DD. */
  judgedAsOf: string;
  /**
   * The day the claim was said, YYYY-MM-DD, when known (the recording date).
   * Time words in the claim ("now", "in 48 years") are judged for that day.
   */
  saidOn?: string;
}

export interface ModelVerdict {
  label: Label;
  conclusion: string;
  missing: string | null;
  /** Each evidence number's stance; numbers the model left out are absent. */
  stances: Map<number, Stance>;
}

const LABELS: readonly Label[] = ['True', 'Misleading', 'False', 'Unverified'];
const STANCES: readonly Stance[] = ['supports', 'contradicts', 'neither'];

const SYSTEM = `You are a careful, nonpartisan fact-checker judging one claim from a live political video.
Use ONLY the numbered sources given, as of the judged-as-of date. Ignore anything you remember about this claim.

Keep "literal", "implied", "evidence" and "conclusion" to one short sentence each (25 words at most).

Work in this order:
1. "literal": what the words assert, as a checkable fact.
2. "implied": what an ordinary listener would take away from it.
3. "evidence": what the sources say about that specific fact, citing numbers. If no source addresses the specific fact, say so.
4. "conclusion": one sentence, in plain words, saying what the sources show.
5. "label", decided by these rules, in order:
   - No source addresses the specific fact, or sources conflict with no way to settle it → Unverified.
   - The sources contradict the literal claim, or show it is baseless where evidence points the other way → False.
   - The literal claim holds (or nearly) AND the implied takeaway holds → True.
   - The literal claim holds (or nearly) BUT the implied takeaway is wrong because context is missing → Misleading.
   Amounts and rates: convert to the same time span before comparing. A larger total over a longer period does not contradict a smaller amount over a shorter period.
   Misleading is not a safe middle answer: use it only when you can name the literal fact that is accurate and the context that is missing.
   The label must agree with your conclusion: if your conclusion says the claim is false or unsupported by contrary evidence, the label is False.
   Time words in the claim ("now", "last year", "in 50 years") count from the day it was said.
6. "missing": for Misleading, the context that is missing, in one sentence; otherwise null.
7. "sources": for every numbered source, whether it "supports" or "contradicts" the claim, or "neither" if it doesn't address it.

Short examples (invented):
- "Unemployment fell to 3.5% last month." Sources: the official release says 3.5%. → True.
- "Crime doubled in our city this year." Sources: police data show a 4% rise. → False.
- "Gas prices are down 20% since I took office." Sources: true since a peak in month two, but higher than on inauguration day. → Misleading (missing: the baseline is the peak, not the start).
- "The bill cut 10,000 jobs." Sources discuss the bill but say nothing about jobs. → Unverified.

Each source says how much it counts: "full weight" (primary sources such as official data, courts and journals, and outlets rated reliable) or "counts less" (mixed or unknown reliability). When sources disagree, prefer the full-weight ones; never let sources that count less overrule them.
Reply with JSON only.`;

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['literal', 'implied', 'evidence', 'conclusion', 'label', 'missing', 'sources'],
  properties: {
    literal: { type: 'string' },
    implied: { type: 'string' },
    evidence: { type: 'string' },
    conclusion: { type: 'string' },
    label: { type: 'string', enum: LABELS },
    missing: { type: ['string', 'null'] },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'stance'],
        properties: { source: { type: 'integer' }, stance: { type: 'string', enum: STANCES } },
      },
    },
  },
};

export function verdictPrompt(input: VerdictInput): string {
  const sources = input.evidence.length
    ? input.evidence
        .map((e) => `[${e.n}] ${e.domain} (${tier(e)})${e.published ? ` (${e.published})` : ''}: ${e.title}\n${e.snippet}`)
        .join('\n\n')
    : '(no sources found)';
  return [
    `Video: "${input.title}"${input.channel ? `, channel "${input.channel}"` : ''}`,
    ...(input.saidOn ? [`Said on: ${input.saidOn}`] : []),
    `Judged as of: ${input.judgedAsOf}`,
    '',
    'What was said in the ~30 seconds before:',
    `"${input.context || '(nothing)'}"`,
    '',
    'Claim to check:',
    `"${input.literal}"`,
    ...(input.speaker ? [`Said by: ${input.speaker}`] : []),
    ...(input.implied ? ['', 'What the listener is meant to take away:', `"${input.implied}"`] : []),
    '',
    'Sources:',
    sources,
  ].join('\n');
}

/** A source's tier, as the verdict step is told it. Bias is never mentioned: it only balances the search. */
function tier(e: Evidence): string {
  if (e.rating.kind === 'primary') return 'primary source, full weight';
  if (e.weight === 'full') return 'reliable outlet, full weight';
  if (e.rating.kind === 'mbfc' && e.rating.reliability === 'mixed') return 'mixed reliability, counts less';
  if (e.rating.kind === 'mbfc' && e.rating.reliability === 'mostly factual') return 'mostly factual, counts less';
  return 'reliability not rated, counts less';
}

export async function judge(model: JsonModel, input: VerdictInput): Promise<ModelVerdict> {
  const reply = await model.generate({ name: 'verdict', system: SYSTEM, user: verdictPrompt(input), schema: SCHEMA });
  return parseVerdict(reply);
}

function parseVerdict(reply: unknown): ModelVerdict {
  const bad = () => new ProviderError('failed', 'verdict reply does not match its schema');
  if (typeof reply !== 'object' || reply === null) throw bad();
  const r = reply as Record<string, unknown>;
  const label = LABELS.find((l) => l === r.label);
  const conclusion = typeof r.conclusion === 'string' ? r.conclusion.trim() : '';
  if (!label || !conclusion) throw bad();
  const stances = new Map<number, Stance>();
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    const entry = s as Record<string, unknown>;
    const stance = STANCES.find((x) => x === entry?.stance);
    if (typeof entry?.source === 'number' && stance) stances.set(entry.source, stance);
  }
  const missing = typeof r.missing === 'string' && r.missing.trim() ? r.missing.trim() : null;
  return { label, conclusion, missing: label === 'Misleading' ? missing : null, stances };
}
