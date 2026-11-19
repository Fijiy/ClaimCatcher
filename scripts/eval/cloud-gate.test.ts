import { describe, expect, it } from 'vitest';
import { createFakeVenice, type FakeVenice } from '../../src/session/testing/fake-venice';
import type { Label } from '../../src/session/types';
import type { GateCase } from './eval-set';
import { candidateModels, pickModel, runCloudGate, type ModelOutcome } from './cloud-gate';
import { scoreGate } from './score';

function rated(id: string, truth: GateCase['truth']): GateCase {
  return {
    id,
    clip: id.split('#')[0]!,
    date: '2024-06-27',
    truth,
    accept: [truth],
    basis: 'firm',
    input: { literal: `claim ${id}`, implied: '', context: '', title: 'Debate', evidence: [], judgedAsOf: '2024-06-27' },
  };
}

const cases = [rated('a#0', 'True'), rated('b#0', 'Misleading'), rated('c#0', 'False')];

/** One Venice entry from `GET /models?type=text`, with only the fields that matter here. */
function listed(id: string, spec: { privacy?: string; reasoning?: boolean; schema?: boolean; deprecated?: boolean } = {}) {
  return {
    id,
    type: 'text',
    model_spec: {
      privacy: spec.privacy ?? 'private',
      offline: false,
      ...(spec.deprecated ? { deprecation: { date: '2026-11-01' } } : {}),
      capabilities: { supportsReasoning: spec.reasoning ?? false, supportsResponseSchema: spec.schema ?? true, supportsE2EE: id.startsWith('e2ee-') },
    },
  };
}

/** Venice, with one fake per model id (chat requests go to their model's fake; everything else to the first). */
function venice(models: Record<string, (claim: string) => Label | { status: number; error: string }>) {
  const fakes = new Map<string, FakeVenice>();
  for (const [model, answer] of Object.entries(models)) {
    const fake = createFakeVenice();
    fake.onVerdict(({ user }) => {
      const claim = /claim (\w#\d)/.exec(user)![1]!;
      const label = answer(claim);
      if (typeof label === 'object') return label;
      return { literal: 'l', implied: 'i', evidence: 'e', conclusion: 'The sources say so.', label, missing: null, sources: [] };
    });
    fakes.set(model, fake);
  }
  const first = [...fakes.values()][0]!;
  const sent: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push(`${init?.method ?? 'GET'} ${url} ${new Headers(init?.headers).get('authorization')}`);
    const model = typeof init?.body === 'string' ? (JSON.parse(init.body) as { model?: string }).model : undefined;
    return (fakes.get(model ?? '') ?? first).fetch(input, init);
  }) as typeof fetch;
  return { fetch: fetchFn, sent, keyCheck: first.onKeyCheck };
}

const truthOf = (claim: string): Label => cases.find((c) => c.id === claim)!.truth;

describe('the cloud run of the gate', () => {
  it("measures only private, non-reasoning models with JSON-schema output, e2ee ones first", () => {
    const list = {
      data: [
        listed('qwen3-235b-a22b-instruct-2507'),
        listed('llama-anonymized', { privacy: 'anonymized' }),
        listed('kimi-k3', { reasoning: true }),
        listed('e2ee-qwen-2-5-7b-p', { schema: false }),
        listed('e2ee-future-instruct'),
        listed('mistral-small-3-2-24b-instruct'),
        listed('retiring-model', { deprecated: true }),
      ],
    };
    expect(candidateModels(list)).toEqual(['e2ee-future-instruct', 'qwen3-235b-a22b-instruct-2507', 'mistral-small-3-2-24b-instruct']);
  });

  it('runs every candidate through the shipped verdict step, sending only chat requests with the key to the provider', async () => {
    const v = venice({ good: truthOf, sloppy: () => 'Misleading' });
    const outcomes = await runCloudGate(cases, { fetch: v.fetch, apiKey: 'test-key', models: ['good', 'sloppy'] });
    expect(outcomes.map((o) => [o.model, o.score?.pass])).toEqual([
      ['good', true],
      ['sloppy', false],
    ]);
    expect(outcomes[0]!.runs.map((run) => run.map((j) => j.label))).toEqual([
      ['True', 'Misleading', 'False'],
      ['True', 'Misleading', 'False'],
    ]);
    // A free key check first, then two runs × 3 claims × 2 models of chat completions. No search: the evidence is frozen.
    expect(v.sent[0]).toBe('GET https://api.venice.ai/api/v1/api_keys/rate_limits Bearer test-key');
    expect(v.sent.slice(1)).toEqual(Array(12).fill('POST https://api.venice.ai/api/v1/chat/completions Bearer test-key'));
  });

  it('stops before any verdict when the free key check rejects the key', async () => {
    const v = venice({ good: truthOf });
    v.keyCheck(() => ({ status: 401, error: 'Authentication failed' }));
    await expect(runCloudGate(cases, { fetch: v.fetch, apiKey: 'bad', models: ['good'] })).rejects.toThrow(/rejected/);
    expect(v.sent).toHaveLength(1);
  });

  it("skips a model the key can't use, and still runs the others", async () => {
    const v = venice({ pro: () => ({ status: 401, error: 'PRO_ONLY_MODEL' }), good: truthOf });
    const outcomes = await runCloudGate(cases, { fetch: v.fetch, apiKey: 'k', models: ['pro', 'good'] });
    expect(outcomes.map((o) => [o.model, o.skipped ?? null, o.score?.pass ?? null])).toEqual([
      ['pro', 'PRO_ONLY_MODEL', null],
      ['good', null, true],
    ]);
  });
});

describe('picking the cloud model', () => {
  const outcome = (model: string, labels: Label[], ms = 2000): ModelOutcome => {
    const runs = [0, 1].map(() => cases.map((c, i) => ({ caseId: c.id, label: labels[i]!, ms })));
    return { model, runs, score: scoreGate(cases, runs), costUsd: null };
  };
  const perfect: Label[] = ['True', 'Misleading', 'False'];

  it('picks only a model that clears the bar', () => {
    expect(pickModel([outcome('slow', perfect, 20_000), outcome('wrong', ['False', 'Misleading', 'False'])])).toBeNull();
    expect(pickModel([outcome('slow', perfect, 20_000), outcome('ok', perfect)])?.model).toBe('ok');
  });

  it('prefers an e2ee model among those that clear it, then the higher balanced accuracy, then the faster', () => {
    const twoThirds = outcome('two-thirds', ['True', 'Misleading', 'Misleading']);
    expect(pickModel([outcome('plain', perfect), outcome('e2ee-model', perfect, 5000)])?.model).toBe('e2ee-model');
    // two-thirds clears the bar too (balanced accuracy 67%), but the others score higher.
    expect(pickModel([twoThirds, outcome('fast', perfect, 1000), outcome('slower', perfect, 3000)])?.model).toBe('fast');
  });
});
