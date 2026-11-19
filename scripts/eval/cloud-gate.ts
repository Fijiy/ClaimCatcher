// The cloud run of the verdict gate: the same cases and bar as local mode,
// once per candidate provider model, through the shipped provider adapter
// (createVenice) and verdict step. The model that clears the bar is cloud
// mode's model (spec "Cloud mode": the exact model is the one that clears the
// quality gate).
//
// Candidates have all three must-haves (cac-notes DECISIONS.md): `private`
// (never `anonymized`), non-reasoning, and JSON-schema output, which
// venice.ts relies on. `e2ee-*` is a preference among models that clear the
// bar, not a rule; today no e2ee model has schema output without reasoning.

import { failureKind, ProviderError } from '../../src/session/checks/provider';
import { checkVeniceKey, createVenice, PROVIDER_ORIGIN } from '../../src/session/checks/venice';
import type { GateCase } from './eval-set';
import { runGate, type GateOptions } from './gate';
import { scoreGate, type GateScore, type Judged } from './score';

interface ListedModel {
  id?: unknown;
  model_spec?: {
    privacy?: unknown;
    offline?: unknown;
    deprecation?: unknown;
    capabilities?: { supportsReasoning?: unknown; supportsResponseSchema?: unknown };
  };
}

const isE2ee = (model: string) => model.startsWith('e2ee-');

/** The candidates in a `GET /models?type=text` reply, e2ee ones first. Retiring and offline models are left out. */
export function candidateModels(reply: unknown): string[] {
  const data = (reply as { data?: unknown } | null)?.data;
  const ids = (Array.isArray(data) ? (data as ListedModel[]) : []).flatMap((m) => {
    const spec = m.model_spec;
    const ok =
      typeof m.id === 'string' &&
      spec?.privacy === 'private' &&
      spec.capabilities?.supportsReasoning === false &&
      spec.capabilities?.supportsResponseSchema === true &&
      !spec.deprecation &&
      spec.offline !== true;
    return ok ? [m.id as string] : [];
  });
  return [...ids.filter(isE2ee), ...ids.filter((id) => !isE2ee(id))];
}

/** Venice's model list needs no key. */
export async function listCandidates(fetchFn: typeof fetch): Promise<string[]> {
  const response = await fetchFn(`${PROVIDER_ORIGIN}/api/v1/models?type=text`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Venice's model list answered ${response.status}`);
  return candidateModels(await response.json());
}

export interface ModelOutcome {
  model: string;
  /** Set when the key can't use this model (Venice answered 401, e.g. a paid-plan-only model); then nothing was scored. */
  skipped?: string;
  runs: Judged[][];
  score?: GateScore;
  /** What Venice charged for the model's verdicts (`cost.usd` on each reply), if it said. */
  costUsd: number | null;
}

export interface CloudGateOptions extends Pick<GateOptions, 'runs' | 'now'> {
  fetch: typeof fetch;
  apiKey: string;
  models: string[];
  onVerdict?: (model: string, run: number, index: number, judged: Judged) => void;
}

/**
 * Checks the key for free first and stops if Venice refuses it, then runs the
 * gate per model. Running out of credit stops everything; a model the key
 * can't use is skipped.
 */
export async function runCloudGate(cases: GateCase[], options: CloudGateOptions): Promise<ModelOutcome[]> {
  const key = await checkVeniceKey(options.fetch, options.apiKey);
  if (key.status === 'rejected') throw new Error('Venice rejected the API key (mistyped, revoked or expired)');
  if (key.status === 'no-credit') throw new Error('The Venice API key has no credit');
  if (key.status === 'not-permitted') throw new Error("Venice doesn't let this API key run models");
  if (key.status === 'unchecked') throw new Error(`Couldn't check the Venice API key: ${key.reason}`);

  const outcomes: ModelOutcome[] = [];
  for (const model of options.models) {
    const meter = metered(options.fetch);
    try {
      const runs = await runGate(cases, () => createVenice(meter.fetch, options.apiKey, model).model, {
        ...(options.runs !== undefined ? { runs: options.runs } : {}),
        ...(options.now ? { now: options.now } : {}),
        onVerdict: (run, index, judged) => options.onVerdict?.(model, run, index, judged),
      });
      outcomes.push({ model, runs, score: scoreGate(cases, runs), costUsd: meter.costUsd() });
    } catch (error) {
      if (failureKind(error) !== 'key-rejected') throw error;
      outcomes.push({ model, skipped: (error as ProviderError).message, runs: [], costUsd: meter.costUsd() });
    }
  }
  return outcomes;
}

/**
 * The model that clears the bar: an e2ee one if any does, then the highest
 * balanced accuracy (worst run), then the fastest median, then the cheapest.
 * Null if none clears it.
 */
export function pickModel(outcomes: ModelOutcome[]): ModelOutcome | null {
  const balanced = (o: ModelOutcome) => Math.min(...o.score!.runs.map((r) => r.balanced));
  const passing = outcomes.filter((o) => o.score?.pass);
  passing.sort(
    (a, b) =>
      Number(isE2ee(b.model)) - Number(isE2ee(a.model)) ||
      balanced(b) - balanced(a) ||
      a.score!.medianMs - b.score!.medianMs ||
      (a.costUsd ?? Infinity) - (b.costUsd ?? Infinity),
  );
  return passing[0] ?? null;
}

/** A fetch that adds up `cost.usd` from Venice's chat replies. */
function metered(fetchFn: typeof fetch) {
  let total: number | null = null;
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchFn(input, init);
    if (String(input instanceof Request ? input.url : input).endsWith('/chat/completions') && response.ok) {
      try {
        const usd = ((await response.clone().json()) as { cost?: { usd?: unknown } }).cost?.usd;
        if (typeof usd === 'number') total = (total ?? 0) + usd;
      } catch {
        // Not JSON: venice.ts reports that itself.
      }
    }
    return response;
  }) as typeof fetch;
  return { fetch: wrapped, costUsd: () => total };
}
