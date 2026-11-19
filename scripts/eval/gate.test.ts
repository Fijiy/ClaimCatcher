import { describe, expect, it } from 'vitest';
import { ProviderError, type JsonModel } from '../../src/session/checks/provider';
import type { Label } from '../../src/session/types';
import type { GateCase } from './eval-set';
import { runGate } from './gate';

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

const cases = [rated('a#0', 'True'), rated('b#0', 'False')];

type Reply = { label: Label; conclusion: string } | Error;

/**
 * A model that answers each verdict prompt from a script keyed by the claim it
 * checks (each case's claim is in its prompt). A list answers attempt by attempt.
 */
function scripted(script: Record<string, Reply | Reply[]>): JsonModel {
  const asked = new Map<string, number>();
  return {
    async generate({ user }) {
      const id = Object.keys(script).find((key) => user.includes(`claim ${key}`));
      if (!id) throw new Error(`no script for ${user}`);
      const n = asked.get(id) ?? 0;
      asked.set(id, n + 1);
      const entry = script[id]!;
      const reply = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)]! : entry;
      if (reply instanceof Error) throw reply;
      return { literal: 'l', implied: 'i', evidence: 'e', conclusion: reply.conclusion, label: reply.label, missing: null, sources: [] };
    },
  };
}

const ok = (label: Label, conclusion = 'The sources show it.') => ({ label, conclusion });
const labels = (runs: Array<Array<{ caseId: string; label: Label }>>) => runs.map((run) => run.map((v) => `${v.caseId} ${v.label}`));

describe('running the verdict gate', () => {
  it('runs every case through the verdict step once per run, on a fresh model each run', async () => {
    const models: number[] = [];
    const runs = await runGate(cases, (run) => {
      models.push(run);
      return scripted({ 'a#0': ok(run === 0 ? 'True' : 'Misleading'), 'b#0': ok('False', 'The sources contradict it.') });
    });
    expect(models).toEqual([0, 1]);
    expect(labels(runs)).toEqual([
      ['a#0 True', 'b#0 False'],
      ['a#0 Misleading', 'b#0 False'],
    ]);
  });

  it("applies the consistency rule, as the shipped pipeline does", async () => {
    const runs = await runGate(cases, () => scripted({ 'a#0': ok('True'), 'b#0': ok('False', 'There is no evidence for this figure.') }), { runs: 1 });
    expect(labels(runs)).toEqual([['a#0 True', 'b#0 Unverified']]);
  });

  it('retries a failed verdict once, then ends the claim Unverified with the error', async () => {
    const crash = new ProviderError('failed', 'Gemini Nano: UnknownError: kErrorUnknown', 'on-device');
    const runs = await runGate(cases, () => scripted({ 'a#0': [crash, ok('True')], 'b#0': [crash, crash] }), { runs: 1 });
    expect(runs[0]).toMatchObject([
      { caseId: 'a#0', label: 'True' },
      { caseId: 'b#0', label: 'Unverified', error: 'Gemini Nano: UnknownError: kErrorUnknown' },
    ]);
    expect(runs[0]![0]!.error).toBeUndefined();
  });

  it('stops the whole gate when the key is rejected or out of credit', async () => {
    const rejected = new ProviderError('key-rejected', 'Authentication failed');
    await expect(runGate(cases, () => scripted({ 'a#0': rejected, 'b#0': ok('False') }))).rejects.toThrow('Authentication failed');
    const broke = new ProviderError('no-credit', 'Insufficient USD or Diem balance');
    await expect(runGate(cases, () => scripted({ 'a#0': ok('True'), 'b#0': broke }))).rejects.toThrow('Insufficient');
  });

  it("stops the gate when the harness itself breaks, rather than scoring it as Unverified", async () => {
    const gone = new Error('Target page, context or browser has been closed');
    await expect(runGate(cases, () => scripted({ 'a#0': gone, 'b#0': ok('False') }))).rejects.toThrow('has been closed');
  });

  it('times each verdict, retry included, on the given clock', async () => {
    let t = 0;
    const slow: JsonModel = {
      async generate(request) {
        t += 4000;
        return scripted({ 'a#0': ok('True'), 'b#0': ok('False', 'The sources contradict it.') }).generate(request);
      },
    };
    const runs = await runGate(cases, () => slow, { runs: 1, now: () => t });
    expect(runs[0]!.map((v) => v.ms)).toEqual([4000, 4000]);
  });

  it('reports progress after each verdict', async () => {
    const seen: string[] = [];
    await runGate(cases, () => scripted({ 'a#0': ok('True'), 'b#0': ok('False', 'The sources contradict it.') }), {
      runs: 2,
      onVerdict: (run, index, judged) => seen.push(`${run}:${index}:${judged.label}`),
    });
    expect(seen).toEqual(['0:0:True', '0:1:False', '1:0:True', '1:1:False']);
  });
});
